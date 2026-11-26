import { describe, expect, it } from "vitest";
import { closeness, costcodle, costcodleNumberFor, money, parseCostcodle } from "./costcodle";

// Laid out the way costcodle.com's share.js builds it.
const SHARE = [
  "Went full Bulk Buyer on today's Costcodle and walked out $24.10 off the mark!",
  "",
  "Costcodle Checkout #14",
  "1. Kirkland Signature Olive Oil — off $3.20",
  "2. Rotisserie Chicken — off $0.00",
  "3. 65\" TV - Big One — off $1,234.56",
  "4. Hot Dog Combo — off $0.50",
  "5. Paper Towels, 12-pack — off $10.00",
  "",
  "Play now at https://www.costcodle.com",
].join("\n");

describe("costcodleNumberFor", () => {
  it("numbers Checkout days from 2026-11-09, by local date", () => {
    // Costcodle's own day 1,148 (Checkout #1): its epoch is 2023-09-21 = day 2.
    const day1148 = new Date(2023, 8, 21 + 1146);
    expect(costcodleNumberFor(day1148)).toBe(1);
    expect(costcodleNumberFor(new Date(2026, 10, 23, 23, 59))).toBe(14);
    expect(costcodle.puzzleForDate([2026, 11, 23])).toBe("14");
  });
});

describe("parseCostcodle", () => {
  it("reads the five misses and adds them up", () => {
    const r = parseCostcodle(SHARE);
    expect(r).toEqual({ ok: true, result: { puzzle: "14", offs: [320, 0, 123456, 50, 1000], total: 124826 } });
    expect(costcodle.formatScore(r.ok ? r.result : ({} as never))).toBe("$1,248.26");
  });

  it("reads Windows line breaks and an en dash", () => {
    const r = parseCostcodle(SHARE.replace(/\n/g, "\r\n").replace(/—/g, "–"));
    expect(r.ok && r.result.total).toBe(124826);
  });

  it("turns away Classic, archive shares and missing items", () => {
    expect(parseCostcodle("Costcodle Classic #1160 3/6\n⬆️🟥\n⬇️🟨\n✅")).toEqual({
      ok: false,
      error: expect.stringMatching(/Classic/),
    });
    expect(
      parseCostcodle("I earned my Costcodle Gold Star on Costcodle Checkout #3 with a total off of $9.00!\n\nPlay now"),
    ).toEqual({ ok: false, error: expect.stringMatching(/no items/) });
    expect(parseCostcodle(SHARE.split("\n").slice(0, 6).join("\n"))).toEqual({
      ok: false,
      error: expect.stringMatching(/5 items/),
    });
    expect(parseCostcodle(SHARE.replace("2. Rotisserie", "3. Rotisserie"))).toEqual({
      ok: false,
      error: expect.stringMatching(/in order/),
    });
    expect(parseCostcodle("hello")).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("ranking", () => {
  it("puts the least off overall first; anyone can win", () => {
    const a = { puzzle: "1", offs: [100, 100, 100, 100, 100], total: 500 };
    const b = { puzzle: "1", offs: [0, 0, 0, 0, 501], total: 501 };
    expect(costcodle.compare(a, b)).toBeLessThan(0);
    expect(costcodle.canWin(b)).toBe(true);
    expect(costcodle.average([a, b])).toBe("$5.01");
  });
});

it("writes every amount in dollars and cents, chips included", () => {
  expect([0, 320, 1250, 34049, 123456].map(money)).toEqual(["$0.00", "$3.20", "$12.50", "$340.49", "$1,234.56"]);
  expect([200, 201, 1000, 1001].map(closeness)).toEqual(["near", "mid", "mid", "far"]);
});
