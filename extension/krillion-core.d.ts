// Types for krillion-core.js (plain JS so Chrome can load it without a build step).
import type { KrillionResult } from "../src/games/krillion";

export type FinishedDive = {
  puzzle: string;
  date: string;
  tiers: string;
  /** The Krillion account it was played on, or null when signed out. */
  account?: string | null;
};

declare const core: {
  numberFromDate(date: string): number;
  accountOf(key: string): string | null;
  findFinishedDives(entries: [string, string][], days?: number): FinishedDive[];
  toResult(dive: FinishedDive): KrillionResult;
  shareText(result: KrillionResult): string;
  formatScore(result: KrillionResult): string;
};
export default core;
