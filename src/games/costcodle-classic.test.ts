import { describe, expect, it } from "vitest";
import { parseCostcodle } from "./costcodle";
import { costcodleClassic, costcodleClassicNumberFor, manualCostcodleClassic, parseCostcodleClassic } from "./costcodle-classic";

// Laid out like costcodle.com's own share (scripts/main.js, buildShareOutput).
const SHARE = "Costcodle Classic #1164 3/6\n⬆️🟥\n⬇️🟨\n✅\n\nPlay now at https://www.costcodle.com";

describe("costcodleClassicNumberFor", () => {
  it("uses Costcodle's own day numbers (#2 on 2023-09-21), by local date", () => {
    expect(costcodleClassicNumberFor(new Date(2023, 8, 21, 12))).toBe(2);
    expect(costcodleClassicNumberFor(new Date(2026, 10, 26, 12))).toBe(1164);
    expect(costcodleClassic.puzzleForDate([2026, 11, 26])).toBe("1164");
  });
});

describe("parseCostcodleClassic", () => {
  it("reads the score and each guess", () => {
    expect(parseCostcodleClassic(SHARE)).toEqual({
      ok: true,
      result: { puzzle: "1164", solved: true, guesses: 3, grid: ["ur", "dy", "w"] },
    });
  });

  it("reads a miss", () => {
    const rows = Array(6).fill("⬆️🟨").join("\n");
    const r = parseCostcodleClassic(`Costcodle Classic #1,164 X/6\n${rows}`);
    expect(r).toEqual({ ok: true, result: { puzzle: "1164", solved: false, guesses: null, grid: Array(6).fill("uy") } });
    expect(costcodleClassic.formatScore(r.ok ? r.result : ({} as never))).toBe("X/6");
  });

  it("rejects guesses that don't fit the score", () => {
    expect(parseCostcodleClassic("Costcodle Classic #1164 2/6\n✅")).toMatchObject({ ok: false });
    expect(parseCostcodleClassic("Costcodle Classic #1164 2/6\n✅\n✅")).toMatchObject({ ok: false });
    expect(parseCostcodleClassic("Costcodle Classic #1164 X/6\n⬆️🟥")).toMatchObject({ ok: false });
    expect(parseCostcodleClassic("Costcodle Classic #1164 1/6")).toMatchObject({ ok: false, error: /guesses/ });
  });

  it("sends each mode's share to its own card", () => {
    expect(parseCostcodleClassic("Costcodle Checkout #17\n1. Thing — off $1.00")).toMatchObject({
      ok: false,
      error: /Checkout/,
    });
    expect(parseCostcodle(SHARE)).toMatchObject({ ok: false, error: /Classic/ });
  });
});

it("ranks like Wordle: fewest guesses, misses last and unable to win", () => {
  const [two, five, miss] = [2, 5, null].map((g) => manualCostcodleClassic("1", g));
  expect(costcodleClassic.compare(two, five)).toBeLessThan(0);
  expect(costcodleClassic.compare(five, miss)).toBeLessThan(0);
  expect(costcodleClassic.canWin(miss)).toBe(false);
  expect(costcodleClassic.average([two, five, miss])).toBe("3.50");
});
