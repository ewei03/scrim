import { describe, expect, it } from "vitest";
import { parsePoople, poople, poopleNumberFor } from "./poople";

// Laid out the way poople.io builds it: a row per word, starting word first.
const SHARE = "Poople #466 5/4\n⬜⬜⬜⬜\n🟫⬜⬜⬜\n🟫🟫⬜⬜\n🟫🟫🟫⬜\n🟫🟫🟫⬜\n🟫🟫🟫🟫\n\nhttps://poople.io/";

describe("poopleNumberFor", () => {
  it("numbers puzzles from 2025-08-14, changing at 08:00 UTC", () => {
    expect(poopleNumberFor(new Date(Date.UTC(2025, 7, 15, 8)))).toBe(1);
    expect(poopleNumberFor(new Date(Date.UTC(2025, 7, 15, 7, 59)))).toBe(0);
    expect(poopleNumberFor(new Date(Date.UTC(2026, 10, 23, 12)))).toBe(466);
    expect(poople.puzzleForDate([2026, 11, 23])).toBe("466");
    expect(poople.zone).toBe("Etc/GMT+8");
  });
});

describe("parsePoople", () => {
  it("reads the steps, the shortest path and the grid", () => {
    const r = parsePoople(SHARE);
    expect(r).toEqual({
      ok: true,
      result: { puzzle: "466", guesses: 5, best: 4, grid: ["....", "p...", "pp..", "ppp.", "ppp.", "pppp"] },
    });
    expect(poople.formatScore(r.ok ? r.result : ({} as never))).toBe("5/4");
  });

  it("stars the shortest path", () => {
    const r = parsePoople("Poople #466 1/1\n🟫🟫🟫⬜\n🟫🟫🟫🟫");
    expect(r.ok && poople.formatScore(r.result)).toBe("⭐");
  });

  it("turns away grids that can't happen", () => {
    expect(parsePoople("Poople #466 5/4\n⬜⬜⬜⬜\n🟫🟫🟫🟫")).toMatchObject({ ok: false, error: /match the steps/ });
    expect(parsePoople("Poople #466 1/1\n⬜⬜⬜⬜\n🟫🟫🟫🟫")).toMatchObject({ ok: false, error: /one letter/ });
    expect(parsePoople("Poople #466 1/1\n🟫🟫🟫⬜\n🟫🟫⬜⬜")).toMatchObject({ ok: false, error: /POOP/ });
    expect(parsePoople("Poople #466 2/3\n🟫🟫⬜⬜\n🟫🟫🟫⬜\n🟫🟫🟫🟫")).toMatchObject({
      ok: false,
      error: /shortest path/,
    });
    expect(parsePoople("Poople #466 1/1")).toMatchObject({ ok: false, error: /grid/ });
    expect(parsePoople("hello")).toMatchObject({ ok: false });
  });
});

it("ranks fewest steps first, and averages steps over the shortest path", () => {
  const a = { puzzle: "1", guesses: 4, best: 4 };
  const b = { puzzle: "1", guesses: 7, best: 4 };
  expect(poople.compare(a, b)).toBeLessThan(0);
  expect(poople.canWin(b)).toBe(true);
  expect(poople.average([a, b])).toBe("1.5");
});
