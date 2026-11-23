import { describe, expect, it } from "vitest";
import { manualStrands, parseStrands, strands, strandsNumberFor } from "./strands";

describe("strandsNumberFor", () => {
  it("matches known puzzle numbers", () => {
    expect(strandsNumberFor(new Date(2024, 2, 4))).toBe(1);
    expect(strandsNumberFor(new Date(2025, 2, 4, 23, 59))).toBe(366);
    expect(strandsNumberFor(new Date(2026, 2, 4))).toBe(731);
    expect(strands.puzzleForDate([2026, 3, 4])).toBe("731");
  });
});

describe("parseStrands", () => {
  it("reads a game with hints, skipping the theme", () => {
    const r = parseStrands("Strands #731\n“Pucker up!”\n💡🔵🔵🔵\n🔵🟡💡🔵\n🔵");
    expect(r).toEqual({
      ok: true,
      result: { puzzle: "731", hints: 2, words: 7, spangram: 5, grid: "hbbbbshbb" },
    });
    expect(strands.formatScore(r.ok ? r.result : ({} as never))).toBe("2💡");
  });

  it("reads a perfect game, Windows line breaks and big numbers", () => {
    const r = parseStrands("Strands #1,024\r\n“A theme with 🔵 in it?”\r\n🟡🔵🔵🔵\r\n🔵🔵🔵🔵");
    // The theme line has other text in it, so its dot isn't part of the grid.
    expect(r.ok).toBe(false);
    const ok = parseStrands("Strands #1,024\r\n“Snack time”\r\n🟡🔵🔵🔵\r\n🔵🔵🔵🔵");
    expect(ok.ok && ok.result).toMatchObject({ puzzle: "1024", hints: 0, words: 8, spangram: 1 });
    expect(strands.formatScore(ok.ok ? ok.result : ({} as never))).toBe("⭐");
  });

  it("rejects text that isn't a finished game", () => {
    expect(parseStrands("Wordle 1,612 3/6").ok).toBe(false);
    expect(parseStrands("Strands #5\n“Theme”").ok).toBe(false);
    // No spangram, two spangrams, a short row in the middle, a stray row after.
    expect(parseStrands("Strands #5\n🔵🔵🔵🔵\n🔵🔵").ok).toBe(false);
    expect(parseStrands("Strands #5\n🟡🔵🔵🟡\n🔵🔵").ok).toBe(false);
    expect(parseStrands("Strands #5\n🟡🔵\n🔵🔵🔵🔵").ok).toBe(false);
    expect(parseStrands("Strands #5\n🟡🔵🔵🔵\n\n🔵🔵").ok).toBe(false);
  });
});

describe("ranking", () => {
  it("ranks by fewest hints, and anyone can win", () => {
    const [none, one, three] = [0, 1, 3].map((h) => manualStrands("1", h));
    expect(strands.compare(none, one)).toBeLessThan(0);
    expect(strands.compare(three, one)).toBeGreaterThan(0);
    expect(strands.compare(one, manualStrands("1", 1, 7, 4))).toBe(0);
    expect(strands.canWin(three)).toBe(true);
    expect(strands.average([none, one, three])).toBe("1.33");
    expect(strands.average([])).toBeNull();
  });
});
