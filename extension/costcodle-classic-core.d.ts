// Types for costcodle-classic-core.js (plain JS so Chrome can load it without a build step).
import type { CostcodleClassicResult } from "../src/games/costcodle-classic";

export type FinishedGame = { puzzle: string; solved: boolean; guesses: number; grid: string[] };

declare const core: {
  numberFromDate(date: string): number;
  rowOf(guess: unknown): string | null;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<CostcodleClassicResult>;
  shareText(result: Required<CostcodleClassicResult>): string;
  formatScore(result: Required<CostcodleClassicResult>): string;
};
export default core;
