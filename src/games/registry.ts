import type { GameAdapter } from "./types";
import { wordle } from "./wordle";

// Only free-to-play games belong here (see `GameAdapter.free`).
// Planned next: Connections, then Krillion once its result format is known.
export const GAMES: Record<string, GameAdapter<unknown>> = {
  [wordle.id]: wordle,
};

export function getGame(id: string): GameAdapter<unknown> {
  const game = GAMES[id];
  if (!game) throw new Error(`Unsupported game: ${id}`);
  return game;
}

export function gameList(): GameAdapter<unknown>[] {
  return Object.values(GAMES);
}
