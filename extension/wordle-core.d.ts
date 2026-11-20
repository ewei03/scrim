// Types for wordle-core.js (plain JS so Chrome can load it without a build step).
import type { WordleResult } from "../src/games/wordle";

export type FinishedGame = {
  signedIn: boolean;
  puzzle: string;
  printDate: string;
  solved: boolean;
  guesses: string[];
  hardMode: boolean;
};

declare const core: {
  numberFromPrintDate(printDate: string): number;
  isSignedInKey(key: string): boolean;
  findFinishedGames(entries: [string, string][]): FinishedGame[];
  evaluate(guess: string, answer: string): string;
  gridFromTileStates(rows: string[][]): string[];
  toResult(game: FinishedGame, tileRows: string[][]): WordleResult;
  shareText(result: WordleResult): string;
};
export default core;
