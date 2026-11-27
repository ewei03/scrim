import { angledle } from "./angledle";
import { connections } from "./connections";
import { contexto } from "./contexto";
import { costcodle } from "./costcodle";
import { costcodleClassic } from "./costcodle-classic";
import { globle } from "./globle";
import { krillion } from "./krillion";
import { minecraftdle, minecraftdleItem, minecraftdleMob } from "./minecraftdle";
import { mini, miniHard } from "./mini";
import { nerdle } from "./nerdle";
import { perceptle } from "./perceptle";
import { poople } from "./poople";
import { strands } from "./strands";
import type { GameAdapter } from "./types";
import { waffle } from "./waffle";
import { wordle } from "./wordle";
import { worldle } from "./worldle";

// Only free-to-play games belong here (see `GameAdapter.free`).
export const GAMES: Record<string, GameAdapter<unknown>> = {
  [wordle.id]: wordle,
  [connections.id]: connections,
  [strands.id]: strands,
  [krillion.id]: krillion,
  [contexto.id]: contexto,
  [costcodle.id]: costcodle,
  [costcodleClassic.id]: costcodleClassic,
  [poople.id]: poople,
  [mini.id]: mini,
  [miniHard.id]: miniHard,
  [worldle.id]: worldle,
  [globle.id]: globle,
  [waffle.id]: waffle,
  [nerdle.id]: nerdle,
  [perceptle.id]: perceptle,
  [minecraftdle.id]: minecraftdle,
  [minecraftdleItem.id]: minecraftdleItem,
  [minecraftdleMob.id]: minecraftdleMob,
  [angledle.id]: angledle,
};

export function getGame(id: string): GameAdapter<unknown> {
  const game = GAMES[id];
  if (!game) throw new Error(`Unsupported game: ${id}`);
  return game;
}

export function gameList(): GameAdapter<unknown>[] {
  return Object.values(GAMES);
}
