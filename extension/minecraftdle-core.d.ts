// Types for minecraftdle-core.js (plain JS so Chrome can load it without a build step).
import type { MinecraftdleResult } from "../src/games/minecraftdle";

export type FinishedGame = { game: string; puzzle: string; guesses: number; grid: string[]; streak?: number };

declare const core: {
  MODES: { game: string; path: string; noun: string }[];
  madridDate(ms: number): string;
  numberFromDate(date: string): number;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<MinecraftdleResult>;
  shareText(game: string, result: Required<MinecraftdleResult>): string;
  formatScore(result: MinecraftdleResult): string;
};
export default core;
