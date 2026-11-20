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
  /** Consecutive wins, counting back from the most recent round they played. */
  streak: number;
};

/** Only pass closed rounds of a single game. */
export function crewStats<R>(game: GameAdapter<R>, rounds: StatRound<R>[], memberIds: string[]) {
  const byRecent = [...rounds].sort((a, b) => b.closes_at.localeCompare(a.closes_at));
  // Newest first: whether they won each round they played.
  const wonRounds = new Map<string, boolean[]>(memberIds.map((id) => [id, []]));
  const results = new Map<string, R[]>(memberIds.map((id) => [id, []]));

  for (const round of byRecent) {
    for (const e of rankEntries(game, round.entries)) {
      if (!wonRounds.has(e.user_id)) continue; // left the crew
      wonRounds.get(e.user_id)!.push(e.winner);
      results.get(e.user_id)!.push(e.result);
    }
  }

  const players: PlayerStats[] = memberIds.map((userId) => {
    const won = wonRounds.get(userId)!;
    const wins = won.filter(Boolean).length;
    let streak = 0;
    while (streak < won.length && won[streak]) streak++;
    return {
      userId,
      played: won.length,
      wins,
      winRate: won.length ? wins / won.length : 0,
      average: game.average(results.get(userId)!),
      streak,
    };
  });

  players.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played);
  return { players };
}
