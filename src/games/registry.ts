import { connections } from "./connections";
import { contexto } from "./contexto";
import { krillion } from "./krillion";
import { strands } from "./strands";
import type { GameAdapter } from "./types";
import { wordle } from "./wordle";

// Only free-to-play games belong here (see `GameAdapter.free`).
export const GAMES: Record<string, GameAdapter<unknown>> = {
  [wordle.id]: wordle,
  [connections.id]: connections,
  [strands.id]: strands,
  [krillion.id]: krillion,
  [contexto.id]: contexto,
};

export function getGame(id: string): GameAdapter<unknown> {
  const game = GAMES[id];
  if (!game) throw new Error(`Unsupported game: ${id}`);
  return game;
}

export function gameList(): GameAdapter<unknown>[] {
  return Object.values(GAMES);
}
