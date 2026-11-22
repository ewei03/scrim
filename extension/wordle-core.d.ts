// Types for wordle-core.js (plain JS so Chrome can load it without a build step).
import type { WordleResult } from "../src/games/wordle";

export type FinishedGame = {
  signedIn: boolean;
  /** The NYT account (regiId) it was played on, or null when signed out. */
  account: string | null;
  puzzle: string;
  printDate: string;
  solved: boolean;
  guesses: string[];
  hardMode: boolean;
};

declare const core: {
  numberFromPrintDate(printDate: string): number;
  isSignedInKey(key: string): boolean;
  accountOf(key: string): string | null;
  findFinishedGames(entries: [string, string][]): FinishedGame[];
  findBoardGame(
    entries: [string, string][],
    rows: { state: string | undefined; letter: string }[][],
    today: string,
  ): FinishedGame | null;
  evaluate(guess: string, answer: string): string;
  gridFromTileStates(rows: string[][]): string[];
  toResult(game: FinishedGame, tileRows: string[][]): WordleResult;
  shareText(result: WordleResult): string;
};
export default core;
