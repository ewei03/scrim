// Types for connections-core.js (plain JS so Chrome can load it without a build step).
import type { ConnectionsResult } from "../src/games/connections";

export type FinishedGame = {
  signedIn: boolean;
  /** The NYT account (regiId) it was played on, or null when signed out. */
  account: string | null;
  solvedCategories: unknown[];
  puzzle: string;
  printDate: string;
  solved: boolean;
  mistakes: number | null;
  groups: number | null;
  guesses: unknown[];
};

declare const core: {
  numberFromPrintDate(printDate: string): number;
  isSignedInKey(key: string): boolean;
  accountOf(key: string): string | null;
  findFinishedGames(entries: [string, string][], now?: Date): FinishedGame[];
  levelsFromPuzzle(puzzle: unknown): Map<string, number>;
  gridFromGuesses(guesses: unknown[], levels?: Map<string, number>, solvedCategories?: unknown[]): string[] | null;
  toResult(game: FinishedGame, levels?: Map<string, number>): ConnectionsResult;
  shareText(result: ConnectionsResult): string;
  formatScore(result: ConnectionsResult): string;
};
export default core;
