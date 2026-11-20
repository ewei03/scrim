import { rankEntries } from "@/games/ranking";
import type { GameAdapter } from "@/games/types";

export type StatEntry<R> = { user_id: string; result: R };
export type StatLobby<R> = {
  id: string;
  invite_code: string;
  puzzle_id: string;
  /** When the lobby finished: closed_at if closed early, otherwise closes_at. */
  ended_at: string;
  entries: StatEntry<R>[];
};

export type Performance = {
  lobbyId: string;
  inviteCode: string;
  puzzleId: string;
  place: number;
  winner: boolean;
  score: string;
};

export type PlayerStats = {
  userId: string;
  played: number;
  wins: number;
  winRate: number;
  average: string | null;
  /** Consecutive wins, counting back from the most recent lobby they played. */
  streak: number;
  /** Most recent first. */
  recent: Performance[];
};

/** Only pass closed lobbies of a single game. */
export function crewStats<R>(game: GameAdapter<R>, lobbies: StatLobby<R>[], memberIds: string[]) {
  const byRecent = [...lobbies].sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  const perf = new Map<string, Performance[]>(memberIds.map((id) => [id, []]));
  const results = new Map<string, R[]>(memberIds.map((id) => [id, []]));

  for (const lobby of byRecent) {
    const ranked = rankEntries(game, lobby.entries);
    for (const e of ranked) {
      if (!perf.has(e.user_id)) continue; // left the crew
      perf.get(e.user_id)!.push({
        lobbyId: lobby.id,
        inviteCode: lobby.invite_code,
        puzzleId: lobby.puzzle_id,
        place: e.place,
        winner: e.winner,
        score: game.formatScore(e.result),
      });
      results.get(e.user_id)!.push(e.result);
    }
  }

  const players: PlayerStats[] = memberIds.map((userId) => {
    const recent = perf.get(userId)!;
    const wins = recent.filter((p) => p.winner).length;
    let streak = 0;
    while (streak < recent.length && recent[streak].winner) streak++;
    return {
      userId,
      played: recent.length,
      wins,
      winRate: recent.length ? wins / recent.length : 0,
      average: game.average(results.get(userId)!),
      streak,
      recent: recent.slice(0, 5),
    };
  });

  players.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played);
  return { players };
}
