// Types for angledle-core.js (plain JS so Chrome can load it without a build step).
import type { AngledleResult } from "../src/games/angledle";

export type FinishedGame = { puzzle: string; solved: boolean; guesses: number; grid: string[] };

declare const core: {
  numberAt(ms: number): number;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<AngledleResult>;
  shareText(result: Required<AngledleResult>): string;
  formatScore(result: AngledleResult): string;
};
export default core;
