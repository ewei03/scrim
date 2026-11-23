import { describe, expect, it } from "vitest";
import { costcodle, costcodleNumberFor, parseCostcodle } from "@/games/costcodle";
import core from "./costcodle-core.js";

// Shapes from costcodle.com's own code.
const round = (guessCents: number, actualCents: number, short = "Thing") => ({
  productId: 1,
  name: `${short} (long name)`,
  short,
  image: "x.png",
  guessCents,
  actualCents,
  diffCents: Math.abs(guessCents - actualCents),
});
const rounds = [round(1000, 1320, "Olive Oil"), round(499, 499), round(10000, 9950), round(150, 200), round(2000, 1000)];
const entries = (state: object | null, history: Record<string, object> = {}): [string, string][] => [
  ...(state ? [["checkoutState", JSON.stringify(state)] as [string, string]] : []),
  ["checkoutStats", JSON.stringify({ history })],
  // Classic mode: ignored.
  ["state", JSON.stringify({ gameNumber: 1161, guesses: [], hasWon: true })],
];

describe("findFinishedGames", () => {
  it("reads today's finished Checkout and yesterday's from history, newest first", () => {
    const found = core.findFinishedGames(
      entries(
        { gameNumber: 1161, rounds, phase: "complete" },
        {
          "1160": { gameNumber: 1160, rounds },
          "1150": { gameNumber: 1150, rounds }, // an archive game
        },
      ),
      14,
    );
    expect(found.map((g) => [g.puzzle, g.offs])).toEqual([
      ["14", [320, 0, 50, 50, 1000]],
      ["13", [320, 0, 50, 50, 1000]],
    ]);
    expect(found[0].names[0]).toBe("Olive Oil");
  });

  it("ignores games in progress, misses that don't add up and bad saves", () => {
    expect(
      core.findFinishedGames(entries({ gameNumber: 1161, rounds: rounds.slice(0, 3), phase: "awaitingNext" }), 14),
    ).toEqual([]);
    const fudged = rounds.map((r, i) => (i === 0 ? { ...r, diffCents: 1 } : r));
    expect(core.findFinishedGames(entries({ gameNumber: 1161, rounds: fudged, phase: "complete" }), 14)).toEqual([]);
    expect(core.findFinishedGames([["checkoutState", "{oops"]], 14)).toEqual([]);
    expect(core.findFinishedGames([], 14)).toEqual([]);
  });

  it("numbers games the same way the app does", () => {
    expect(core.numberFromDate("2026-11-23")).toBe(costcodleNumberFor(new Date(2026, 10, 23)));
  });
});

it("builds results whose share text the app can parse", () => {
  const [g] = core.findFinishedGames(entries({ gameNumber: 1161, rounds, phase: "complete" }), 14);
  const result = core.toResult(g);
  const parsed = parseCostcodle(core.shareText(result));
  expect(parsed).toEqual({ ok: true, result: { puzzle: "14", offs: result.offs, total: 1420 } });
  expect(core.formatScore(result)).toBe(costcodle.formatScore(result));
});
