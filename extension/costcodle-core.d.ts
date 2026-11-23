// Types for costcodle-core.js (plain JS so Chrome can load it without a build step).
import type { CostcodleResult } from "../src/games/costcodle";

export type FinishedGame = { puzzle: string; offs: number[]; names: string[] };

declare const core: {
  numberFromDate(date: string): number;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): CostcodleResult & { names: string[] };
  shareText(result: CostcodleResult & { names?: string[] }): string;
  formatScore(result: CostcodleResult): string;
  money(cents: number): string;
};
export default core;
