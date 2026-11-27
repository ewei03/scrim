// Types for perceptle-core.js (plain JS so Chrome can load it without a build step).
import type { PerceptleResult } from "../src/games/perceptle";

export type FinishedGame = { puzzle: string; events: number[] };

declare const core: {
  numberFromDate(date: string): number;
  grade(score: number): string;
  findFinishedGames(entries: [string, string][], today: string): FinishedGame[];
  toResult(game: FinishedGame): Required<PerceptleResult>;
  shareText(result: Required<PerceptleResult>): string;
  formatScore(result: PerceptleResult): string;
};
export default core;
