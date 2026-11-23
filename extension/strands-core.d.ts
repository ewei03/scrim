// Types for strands-core.js (plain JS so Chrome can load it without a build step).
import type { StrandsResult } from "../src/games/strands";

export type FinishedGame = {
  signedIn: boolean;
  /** The NYT account (regiId) it was played on, or null when signed out. */
  account: string | null;
  puzzle: string;
  printDate: string;
  /** The share's dots: b = theme word, s = spangram, h = hint. */
  grid: string;
};

declare const core: {
  numberFromPrintDate(printDate: string): number;
  accountOf(key: string): string | null;
  gridFrom(history: unknown): string | null;
  findFinishedGames(entries: [string, string][]): FinishedGame[];
  toResult(game: FinishedGame): StrandsResult & { grid: string };
  shareText(result: StrandsResult & { grid: string }): string;
  formatScore(result: StrandsResult): string;
};
export default core;
