// Types for contexto-core.js (plain JS so Chrome can load it without a build step).
import type { ContextoResult } from "../src/games/contexto";

type Chart = [number, number, number];

export type FinishedGame = {
  puzzle: string;
  solved: boolean;
  guesses: number;
  hints: number;
  chart: Chart;
  /** The Contexto account (Firebase uid) it was played on, or null when signed out. */
  account?: string | null;
};

declare const core: {
  numberFromDate(date: string): number;
  shareDate(puzzle: string): string;
  chartOf(history: unknown[]): Chart;
  findFinishedGames(entries: [string, string][], today: number, account?: string | null): FinishedGame[];
  toResult(game: FinishedGame): ContextoResult & { chart: Chart };
  shareText(result: ContextoResult & { chart: Chart }): string;
  formatScore(result: ContextoResult): string;
};
export default core;
