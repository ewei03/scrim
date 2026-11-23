// Types for poople-core.js (plain JS so Chrome can load it without a build step).
import type { PoopleResult } from "../src/games/poople";

export type FinishedGame = { puzzle: string; guesses: number; best: number; grid: string[] };

declare const core: {
  numberAt(ms: number): number;
  findFinishedGames(entries: [string, string][], best: number | null, now: number): FinishedGame[];
  bestFrom(text: string | null | undefined): number | null;
  toResult(game: FinishedGame): Required<PoopleResult>;
  shareText(result: Required<PoopleResult>): string;
  formatScore(result: Required<PoopleResult>): string;
};
export default core;
