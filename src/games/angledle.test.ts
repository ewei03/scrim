import { describe, expect, it } from "vitest";
import { angledle, angledleNumberFor, parseAngledle } from "./angledle";

// Share text from angledle.com's code, checked 2026-11-26.
describe("Angledle", () => {
  it("numbers days from 2022-01-01 by local date", () => {
    expect(angledleNumberFor(new Date(2026, 10, 26, 12))).toBe(1790);
    expect(angledle.puzzleForDate([2026, 11, 26])).toBe("1790");
  });

  it("reads the share", () => {
    const text = "Angledle #1790 3/6\n🔴 ↑\n🟡 ↓\n🟢 ✓\nangledle.com";
    expect(parseAngledle(text)).toEqual({
      ok: true,
      result: { puzzle: "1790", solved: true, guesses: 3, grid: ["ru", "yd", "gc"] },
    });
  });

  it("reads what the site's own share builder made for a real game", () => {
    expect(parseAngledle("Angledle #1790 2/6\n🔴 ↑\n🟢 ✓\nangledle.com")).toEqual({
      ok: true,
      result: { puzzle: "1790", solved: true, guesses: 2, grid: ["ru", "gc"] },
    });
  });

  it("reads a miss, and the colour-blind dots", () => {
    const text = "Angledle #1,790 X/6\n⚫ ↑\n🟠 ↓\n🟡 ↑\n🔵 ↓\n🔵 ↑\n🔵 ↓\nangledle.com";
    expect(parseAngledle(text)).toEqual({
      ok: true,
      result: { puzzle: "1790", solved: false, guesses: null, grid: ["ru", "od", "yu", "gd", "gu", "gd"] },
    });
  });

  it("reads the daily summary's share, which has no arrows", () => {
    const text =
      "Angledle #1790\nGuess 3/6 🔴🟢🟢\nDraw It 70/100 🟩🟥🟩\nHigher or Lower 60/100 🟩🟩🟥🟩🟥\nangledle.com";
    expect(parseAngledle(text)).toEqual({
      ok: true,
      result: { puzzle: "1790", solved: true, guesses: 3, grid: ["r", "g", "g"] },
    });
    expect(parseAngledle("Angledle #1790\nGuess X/6 🔴🔴🟠🟡🟢🟢\nangledle.com")).toMatchObject({
      ok: true,
      result: { solved: false, guesses: null },
    });
    expect(parseAngledle("Angledle #1790\nGuess 2/6 🔴🟡\nangledle.com")).toMatchObject({ ok: false });
  });

  it("rejects grids that don't match the score", () => {
    expect(parseAngledle("Angledle #1790 2/6\n🔴 ↑\n🟡 ↓\nangledle.com")).toMatchObject({ ok: false });
    expect(parseAngledle("Angledle #1790 3/6\n🔴 ↑\n🟢 ✓\nangledle.com")).toMatchObject({ ok: false, error: /2 rows/ });
    expect(parseAngledle("Angledle #1790 3/6")).toMatchObject({ ok: false, error: /guesses/ });
    expect(parseAngledle("Angledle 3/6\n🟢 ✓")).toMatchObject({ ok: false, error: /Invalid format/ });
  });

  it("ranks like Wordle", () => {
    const two = { puzzle: "1", solved: true, guesses: 2 };
    const miss = { puzzle: "1", solved: false, guesses: null };
    expect(angledle.compare(two, miss)).toBeLessThan(0);
    expect(angledle.canWin(miss)).toBe(false);
    expect(angledle.formatScore(miss)).toBe("X/6");
  });
});
