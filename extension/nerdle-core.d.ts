// Types for nerdle-core.js (plain JS so Chrome can load it without a build step).
import type { NerdleResult } from "../src/games/nerdle";

export type FinishedGame = { puzzle: string; solved: boolean; guesses: number; grid: string[] };

declare const core: {
  numberAt(ms: number): number;
  rowOf(guess: string, solution: string): string;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<NerdleResult>;
  shareText(result: Required<NerdleResult>): string;
  formatScore(result: Required<NerdleResult>): string;
};
export default core;
