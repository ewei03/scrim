import { describe, expect, it } from "vitest";
import { mini, miniNumberFor, parseMini } from "./mini";

// Laid out the way minicrossword.com builds it.
const SHARE = "Mini Crossword Easy #155: Fall Things\n⬛⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬛\n1:23 | No reveals!\nTop 12% time!\n\nPlay free at minicrossword.com/";

describe("miniNumberFor", () => {
  it("numbers Easy dailies from 2026-06-22 as #1, by local date", () => {
    expect(miniNumberFor(new Date(2026, 5, 22))).toBe(1);
    expect(miniNumberFor(new Date(2026, 10, 23, 23, 59))).toBe(155);
    expect(mini.puzzleForDate([2026, 11, 23])).toBe("155");
  });
});

describe("parseMini", () => {
  it("reads the time and no reveals", () => {
    const r = parseMini(SHARE);
    expect(r).toEqual({ ok: true, result: { puzzle: "155", seconds: 83, reveals: 0 } });
    expect(mini.formatScore(r.ok ? r.result : ({} as never))).toBe("1:23");
  });

  it("reads seconds-only times, reveals and pauses, without a title or grid", () => {
    const r = parseMini("Mini Crossword Easy #155\n45s | Reveals: 2 | Pauses: 1\n\nPlay free at minicrossword.com/");
    expect(r).toEqual({ ok: true, result: { puzzle: "155", seconds: 45, reveals: 2 } });
    expect(mini.formatScore(r.ok ? r.result : ({} as never))).toBe("45s +2💡");
  });

  it("turns away Hard, Unlimited and archive puzzles", () => {
    expect(parseMini(SHARE.replace("Easy", "Hard"))).toMatchObject({ ok: false, error: /Easy/ });
    expect(parseMini("Mini Crossword - Unlimited #77\n⏱️ 1:00 | No reveals!")).toMatchObject({
      ok: false,
      error: /Unlimited/,
    });
    expect(parseMini(SHARE.replace("minicrossword.com/", "https://minicrossword.com/archive/easy/150"))).toMatchObject({
      ok: false,
      error: /Archive/,
    });
    expect(parseMini("Mini Crossword Easy #155")).toMatchObject({ ok: false, error: /time/ });
  });
});

it("ranks fewest reveals first, then fastest", () => {
  const clean = { puzzle: "1", seconds: 300, reveals: 0 };
  const fast = { puzzle: "1", seconds: 30, reveals: 1 };
  const faster = { puzzle: "1", seconds: 20, reveals: 1 };
  expect(mini.compare(clean, fast)).toBeLessThan(0);
  expect(mini.compare(faster, fast)).toBeLessThan(0);
  expect(mini.average([clean, fast, faster])).toBe("1:57");
});
