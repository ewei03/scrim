// Types for worldle-core.js (plain JS so Chrome can load it without a build step).
import type { WorldleResult } from "../src/games/worldle";

export type FinishedGame = { puzzle: string; solved: boolean; guesses: number; grid: string[] };

declare const core: {
  numberFromDate(date: string): number;
  rowOf(distance: number): string;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<WorldleResult>;
  shareText(result: Required<WorldleResult>): string;
  formatScore(result: Required<WorldleResult>): string;
};
export default core;
