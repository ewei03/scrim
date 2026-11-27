import { rankEntries } from "@/games/ranking";
import type { GameAdapter } from "@/games/types";

export type StatEntry<R> = { user_id: string; result: R };
export type StatRound<R> = {
  id: string;
  /** When the round closed. */
  closes_at: string;
  entries: StatEntry<R>[];
};

export type PlayerStats = {
  userId: string;
  played: number;
  wins: number;
  winRate: number;
  average: string | null;
  /** Consecutive wins, counting back from the most recent round. A skipped day ends it. */
  streak: number;
  /** Longest run of consecutive wins. A skipped day breaks a run. */
  maxStreak: number;
};

/**
 * Only pass closed rounds of a single game. Players come back ranked by total
 * wins, then win rate, then days played (mirrored in extension_rankings, SQL).
 * Win rate and average only count days played; streaks count every day, so a
 * skipped day ends one.
 */
export function crewStats<R>(game: GameAdapter<R>, rounds: StatRound<R>[], memberIds: string[]) {
  const byRecent = [...rounds].sort((a, b) => b.closes_at.localeCompare(a.closes_at));
  // Newest first: whether they won each round they played.
  const wonRounds = new Map<string, boolean[]>(memberIds.map((id) => [id, []]));
  // Newest first, every round: won, lost, or skipped (false), for streaks.
  const streakRounds = new Map<string, boolean[]>(memberIds.map((id) => [id, []]));
  const results = new Map<string, R[]>(memberIds.map((id) => [id, []]));

  for (const round of byRecent) {
    const won = new Map<string, boolean>();
    for (const e of rankEntries(game, round.entries)) {
      if (!wonRounds.has(e.user_id)) continue; // left the crew
      wonRounds.get(e.user_id)!.push(e.winner);
      results.get(e.user_id)!.push(e.result);
      won.set(e.user_id, e.winner);
    }
    for (const id of memberIds) streakRounds.get(id)!.push(won.get(id) ?? false);
  }

  const players: PlayerStats[] = memberIds.map((userId) => {
    const won = wonRounds.get(userId)!;
    const wins = won.filter(Boolean).length;
    const days = streakRounds.get(userId)!;
    let streak = 0;
    while (streak < days.length && days[streak]) streak++;
    let maxStreak = 0;
    let run = 0;
    for (const w of days) {
      run = w ? run + 1 : 0;
      maxStreak = Math.max(maxStreak, run);
    }
    return {
      userId,
      played: won.length,
      wins,
      winRate: won.length ? wins / won.length : 0,
      average: game.average(results.get(userId)!),
      streak,
      maxStreak,
    };
  });

  players.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played);
  return { players };
}
