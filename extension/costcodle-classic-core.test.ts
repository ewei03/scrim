import { describe, expect, it } from "vitest";
import { costcodleClassic, costcodleClassicNumberFor, parseCostcodleClassic } from "@/games/costcodle-classic";
import core from "./costcodle-classic-core.js";

// Shapes from costcodle.com's own code (scripts/main.js, checkGuess).
const far = (up: boolean) => ({ guess: "1.00", closeness: "guess-far", direction: up ? "&uarr;" : "&darr;" });
const near = (up: boolean) => ({ guess: "9.00", closeness: "guess-near", direction: up ? "&uarr;" : "&darr;" });
const win = { guess: "10.00", closeness: "guess-win", direction: "&check;" };
const entries = (state: object | null, history: Record<string, object> = {}): [string, string][] => [
  ...(state ? [["state", JSON.stringify(state)] as [string, string]] : []),
  ["stats", JSON.stringify({ history })],
  // Checkout mode: read by costcodle-core.js.
  ["checkoutState", JSON.stringify({ gameNumber: 1164, rounds: [], phase: "complete" })],
];
const TODAY = 1164;

describe("findFinishedGames", () => {
  it("reads today's game and yesterday's from history, newest first", () => {
    const found = core.findFinishedGames(
      entries(
        { gameNumber: 1164, guesses: [far(true), near(false), win], hasWon: true },
        {
          "1163": { gameNumber: 1163, hasWon: false, guesses: Array(6).fill(near(true)) },
          "1100": { gameNumber: 1100, hasWon: true, guesses: [win] }, // an archive game
        },
      ),
      TODAY,
    );
    expect(found).toEqual([
      { puzzle: "1164", solved: true, guesses: 3, grid: ["ur", "dy", "w"] },
      { puzzle: "1163", solved: false, guesses: 6, grid: Array(6).fill("uy") },
    ]);
  });

  it("ignores games in progress, archive days saved without guesses and bad saves", () => {
    expect(core.findFinishedGames(entries({ gameNumber: 1164, guesses: [far(true)], hasWon: false }), TODAY)).toEqual([]);
    expect(core.findFinishedGames(entries(null, { "1164": { gameNumber: 1164, hasWon: true, guesses: [] } }), TODAY)).toEqual(
      [],
    );
    expect(core.findFinishedGames(entries({ gameNumber: 1164, guesses: [win, win], hasWon: true }), TODAY)).toEqual([]);
    expect(core.findFinishedGames([["state", "{oops"]], TODAY)).toEqual([]);
  });

  it("numbers puzzles the same way the app does", () => {
    expect(core.numberFromDate("2026-11-26")).toBe(costcodleClassicNumberFor(new Date(2026, 10, 26)));
  });
});

it("builds results whose share text the app can parse", () => {
  const [g] = core.findFinishedGames(entries({ gameNumber: 1164, guesses: [far(false), near(true), win], hasWon: true }), TODAY);
  const result = core.toResult(g);
  expect(parseCostcodleClassic(core.shareText(result))).toEqual({ ok: true, result });
  expect(core.formatScore(result)).toBe(costcodleClassic.formatScore(result));
});
