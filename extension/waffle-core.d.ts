// Types for waffle-core.js (plain JS so Chrome can load it without a build step).
import type { WaffleResult } from "../src/games/waffle";

export type FinishedGame = { puzzle: string; solved: boolean; stars: number | null };

declare const core: {
  numberAt(ms: number): number;
  findFinishedGames(entries: [string, string][], today: number): FinishedGame[];
  toResult(game: FinishedGame): Required<WaffleResult>;
  shareText(result: Required<WaffleResult>): string;
  formatScore(result: Required<WaffleResult>): string;
};
export default core;
