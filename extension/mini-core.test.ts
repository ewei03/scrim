import { describe, expect, it } from "vitest";
import { mini, miniNumberFor, parseMini } from "@/games/mini";
import core from "./mini-core.js";

// Shapes from minicrossword.com's own code.
const save = (over: Record<string, unknown>): [string, string][] => [
  [
    "crosswordMini_daily_daily-easy",
    JSON.stringify({
      puzzleId: "mini-daily-easy-155",
      userGrid: [],
      elapsedMs: 83_900,
      timerSeconds: 83,
      checksUsed: 0,
      revealedCells: [],
      hintedClues: [],
      pauseCount: 0,
      isComplete: true,
      ...over,
    }),
  ],
  // Archive plays: ignored.
  ["crosswordMini_daily_daily-easy-archive-150", JSON.stringify({ puzzleId: "mini-daily-easy-150", isComplete: true })],
];

describe("findFinishedGames", () => {
  it("reads today's solved Easy daily, with the signed-in account", () => {
    const entries: [string, string][] = [...save({ revealedCells: ["0-1", "2-2"] }), ["heygg_user", JSON.stringify({ id: 42 })]];
    expect(core.findFinishedGames(entries, 155)).toEqual([{ puzzle: "155", seconds: 83, reveals: 2, account: "42" }]);
  });

  it("falls back to the timer, and takes yesterday's", () => {
    expect(core.findFinishedGames(save({ elapsedMs: undefined, puzzleId: "mini-daily-easy-154" }), 155)).toEqual([
      { puzzle: "154", seconds: 83, reveals: 0, account: null },
    ]);
  });

  it("ignores unsolved, older and bad saves", () => {
    expect(core.findFinishedGames(save({ isComplete: false }), 155)).toEqual([]);
    expect(core.findFinishedGames(save({ puzzleId: "mini-daily-easy-150" }), 155)).toEqual([]);
    expect(core.findFinishedGames([["crosswordMini_daily_daily-easy", "{oops"]], 155)).toEqual([]);
  });

  it("numbers puzzles the same way the app does", () => {
    expect(core.numberFromDate("2026-11-23")).toBe(miniNumberFor(new Date(2026, 10, 23)));
  });
});

it("reads the Hard daily on its own", () => {
  const hard: [string, string][] = [
    [
      "crosswordMini_daily_daily-hard",
      JSON.stringify({ puzzleId: "mini-daily-hard-155", elapsedMs: 200_000, revealedCells: [1], isComplete: true }),
    ],
  ];
  expect(core.findFinishedGames(hard, 155)).toEqual([]);
  const [g] = core.findFinishedGames(hard, 155, "hard");
  expect(g).toMatchObject({ puzzle: "155", seconds: 200, reveals: 1 });
  // An Easy save is never taken for Hard.
  expect(core.findFinishedGames(save({}), 155, "hard")).toEqual([]);
  const result = core.toResult(g);
  expect(parseMini(core.shareText(result, "hard"), "hard")).toEqual({ ok: true, result });
});

it("builds results whose share text the app can parse", () => {
  for (const [seconds, reveals] of [
    [83, 0],
    [45, 3],
    [3725, 1],
  ]) {
    const result = core.toResult({ puzzle: "155", seconds, reveals, account: null });
    expect(parseMini(core.shareText(result))).toEqual({ ok: true, result });
    expect(core.formatScore(result)).toBe(mini.formatScore(result));
  }
});
