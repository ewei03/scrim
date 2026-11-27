import { describe, expect, it } from "vitest";
import { MODES, minecraftdle, minecraftdleItem, minecraftdleNumberFor, parseMinecraftdle } from "./minecraftdle";

// Share text from minecraftdle.com's code, checked 2026-11-26.
describe("Minecraftdle", () => {
  it("numbers days by Madrid's date, #18 on 2026-11-27", () => {
    expect(minecraftdleNumberFor(new Date(Date.UTC(2026, 10, 27, 12)))).toBe(18);
    // 23:30 UTC on the 26th is already the 27th in Madrid.
    expect(minecraftdleNumberFor(new Date(Date.UTC(2026, 10, 26, 23, 30)))).toBe(18);
    expect(minecraftdle.puzzleForDate([2026, 11, 27])).toBe("18");
    expect(minecraftdle.zone).toBe("Europe/Madrid");
  });

  it("reads the share", () => {
    const text =
      "Minecraftdle #18 · Block\n3 tries · streak 4\n🟥🟥⬆️🟥\n🟩🟥⬇️🟩\n🟩🟩🟩🟩\nhttps://minecraftdle.com/blocks";
    expect(parseMinecraftdle(text, MODES[0])).toEqual({
      ok: true,
      result: { puzzle: "18", guesses: 3, grid: ["xxux", "cxdc", "cccc"] },
    });
    expect(parseMinecraftdle("Minecraftdle #18 · Item\n1 try\n🟩🟩🟩\nhttps://minecraftdle.com/items", MODES[1])).toEqual({
      ok: true,
      result: { puzzle: "18", guesses: 1, grid: ["ccc"] },
    });
  });

  it("keeps only the tries when the share cut the grid short", () => {
    const rows = Array.from({ length: 10 }, () => "🟥🟥🟥");
    const text = `Minecraftdle #18 · Mob\n12 tries\n${rows.join("\n")}\n… +2\nhttps://minecraftdle.com/mobs`;
    expect(parseMinecraftdle(text, MODES[2])).toEqual({ ok: true, result: { puzzle: "18", guesses: 12 } });
  });

  it("rejects another mode's share, and grids that don't add up", () => {
    const block = "Minecraftdle #18 · Block\n1 try\n🟩🟩🟩🟩\nhttps://minecraftdle.com/blocks";
    expect(minecraftdleItem.parseShareText(block)).toMatchObject({ ok: false, error: /Block, not Item/ });
    expect(parseMinecraftdle("Minecraftdle #18 · Block\n2 tries\n🟥🟥\n🟥🟥", MODES[0])).toMatchObject({ ok: false });
    expect(parseMinecraftdle("Wordle 1,234 3/6", MODES[0])).toMatchObject({ ok: false, error: /Invalid format/ });
  });

  it("ranks fewest tries first, and every result can win", () => {
    expect(minecraftdle.compare({ puzzle: "1", guesses: 2 }, { puzzle: "1", guesses: 5 })).toBeLessThan(0);
    expect(minecraftdle.canWin({ puzzle: "1", guesses: 40 })).toBe(true);
    expect(minecraftdle.average([{ puzzle: "1", guesses: 2 }, { puzzle: "1", guesses: 5 }])).toBe("3.5");
  });
});
