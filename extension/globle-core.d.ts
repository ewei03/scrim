// Types for globle-core.js (plain JS so Chrome can load it without a build step).
import type { GlobleResult } from "../src/games/globle";

export type FinishedGame = { puzzle: string; guesses: number; day: string };

declare const core: {
  numberFromDate(date: string): number;
  findFinishedGames(entries: [string, string][], today: string): FinishedGame[];
  toResult(game: FinishedGame): GlobleResult;
  shareText(result: GlobleResult): string;
  formatScore(result: GlobleResult): string;
};
export default core;
