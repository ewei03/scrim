// Types for mini-core.js (plain JS so Chrome can load it without a build step).
import type { MiniResult } from "../src/games/mini";

export type FinishedGame = MiniResult & { account: string | null };

declare const core: {
  numberFromDate(date: string): number;
  findFinishedGames(entries: [string, string][], today: number, level?: "easy" | "hard"): FinishedGame[];
  toResult(game: FinishedGame): MiniResult;
  shareText(result: MiniResult, level?: "easy" | "hard"): string;
  formatScore(result: MiniResult): string;
};
export default core;
