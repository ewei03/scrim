import { connections } from "./connections";
import { krillion } from "./krillion";
import type { GameAdapter } from "./types";
import { wordle } from "./wordle";

// Only free-to-play games belong here (see `GameAdapter.free`).
export const GAMES: Record<string, GameAdapter<unknown>> = {
  [wordle.id]: wordle,
  [connections.id]: connections,
  [krillion.id]: krillion,
};

export function getGame(id: string): GameAdapter<unknown> {
  const game = GAMES[id];
  if (!game) throw new Error(`Unsupported game: ${id}`);
  return game;
}

export function gameList(): GameAdapter<unknown>[] {
  return Object.values(GAMES);
}
