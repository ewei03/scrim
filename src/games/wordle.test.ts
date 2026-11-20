import { describe, expect, it } from "vitest";
import { rankEntries } from "./ranking";
import { gameList } from "./registry";
import { manualWordle, parseWordle, wordle, wordleNumberFor } from "./wordle";

describe("wordleNumberFor", () => {
  it("matches known puzzle numbers", () => {
    expect(wordleNumberFor(new Date(2021, 5, 19))).toBe(0);
    expect(wordleNumberFor(new Date(2024, 2, 15))).toBe(1000);
    expect(wordleNumberFor(new Date(2026, 10, 19, 23, 59))).toBe(wordleNumberFor(new Date(2026, 10, 19, 0, 1)));
  });
});

describe("parseWordle", () => {
  it("parses a standard share", () => {
    const r = parseWordle("Wordle 1,612 4/6\n\n⬛🟨⬛⬛⬛\n🟩⬛⬛🟨⬛\n🟩🟩⬛🟩⬛\n🟩🟩🟩🟩🟩");
    expect(r).toEqual({
      ok: true,
      result: { puzzle: "1612", solved: true, guesses: 4, hard: false, grid: [".y...", "g..y.", "gg.g.", "ggggg"] },
    });
  });

  it("handles hard mode, light mode, high contrast and variation selectors", () => {
    const r = parseWordle("Wordle 1.612 2/6*\r\n\r\n⬜️🟦⬜️🟧⬜️\r\n🟧🟧🟧🟧🟧");
    expect(r.ok && r.result).toMatchObject({ puzzle: "1612", guesses: 2, hard: true, grid: [".y.g.", "ggggg"] });
  });

  it("handles spaced thousands and surrounding text", () => {
    const r = parseWordle("look at this!! Wordle 1 612 1/6\n🟩🟩🟩🟩🟩\nnice");
    expect(r.ok && r.result).toMatchObject({ puzzle: "1612", guesses: 1, solved: true });
  });

  it("parses a miss", () => {
    const rows = Array(6).fill("⬛⬛🟨⬛⬛").join("\n");
    const r = parseWordle(`Wordle 1,612 X/6\n\n${rows}`);
    expect(r.ok && r.result).toMatchObject({ solved: false, guesses: null });
  });

  it("needs the grid", () => {
    expect(parseWordle("Wordle 1,612 3/6")).toMatchObject({ ok: false, error: /grid/ });
  });

  it("rejects grids that aren't real rows", () => {
    const tenGreen = "🟩".repeat(10);
    // A score with a padded row of greens, typed or pasted as chat shortcodes.
    expect(parseWordle(`Wordle 1,980 4/6 ${tenGreen}`)).toMatchObject({ ok: false, error: /5 squares/ });
    expect(parseWordle(`Wordle 1,980 4/6 ${":green_square:".repeat(10)}`)).toMatchObject({ ok: false, error: /5 squares/ });
    expect(parseWordle("Wordle 1,612 1/6\n🟩🟩🟩🟩🟩 yay")).toMatchObject({ ok: false, error: /something other/ });
    expect(parseWordle("Wordle 1,612 1/6\n🟩🟩🟩🟩🟩\n\n🟩🟩🟩🟩🟩")).toMatchObject({ ok: false, error: /one block/ });
  });

  it("reads chat shortcodes as squares", () => {
    const r = parseWordle(
      "Wordle 1,612 2/6\n:black_large_square::yellow_square::black_large_square::black_large_square::black_large_square:\n" +
        ":large_green_square:".repeat(5),
    );
    expect(r.ok && r.result.grid).toEqual([".y...", "ggggg"]);
  });

  it("checks hard mode keeps greens in place", () => {
    expect(parseWordle("Wordle 1,612 3/6*\n🟩⬛⬛⬛⬛\n⬛🟩⬛⬛⬛\n🟩🟩🟩🟩🟩")).toMatchObject({
      ok: false,
      error: /hard mode/,
    });
    expect(parseWordle("Wordle 1,612 3/6\n🟩⬛⬛⬛⬛\n⬛🟩⬛⬛⬛\n🟩🟩🟩🟩🟩").ok).toBe(true);
  });

  it("rejects mismatched grids and junk", () => {
    expect(parseWordle("Wordle 1,612 3/6\n🟩🟩🟩🟩🟩").ok).toBe(false);
    expect(parseWordle("Wordle 1,612 2/6\n🟩🟩🟩🟩🟩\n🟩🟩🟩🟩🟩").ok).toBe(false);
    expect(parseWordle("Connections Puzzle #500").ok).toBe(false);
  });
});

describe("ranking", () => {
  const e = (id: string, guesses: number | null) => ({ id, result: manualWordle("1", guesses, false) });

  it("shares the win between tied players", () => {
    const ranked = rankEntries(wordle, [e("a", 3), e("b", 1), e("c", 1), e("d", null)]);
    expect(ranked.map((r) => [r.id, r.place, r.winner])).toEqual([
      ["b", 1, true],
      ["c", 1, true],
      ["a", 3, false],
      ["d", 4, false],
    ]);
  });

  it("declares no winner when nobody solved it", () => {
    const ranked = rankEntries(wordle, [e("a", null), e("b", null)]);
    expect(ranked.every((r) => r.place === 1 && !r.winner)).toBe(true);
  });
});

describe("registry", () => {
  it("only contains free games", () => {
    expect(gameList().every((g) => g.free === true)).toBe(true);
  });
});
