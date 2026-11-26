import { describe, expect, it } from "vitest";
import { globle, globleNumberFor, parseGloble } from "./globle";
import { nerdle, nerdleNumberFor, parseNerdle } from "./nerdle";
import { parseWaffle, waffle, waffleNumberFor } from "./waffle";
import { parseWorldle, worldle, worldleNumberFor } from "./worldle";

// Numbers read off each site on 2026-11-26.
describe("puzzle numbers", () => {
  it("match the sites", () => {
    expect(worldleNumberFor(new Date(2026, 10, 26, 12))).toBe(1770);
    expect(waffleNumberFor(new Date(Date.UTC(2026, 10, 26, 12)))).toBe(1770);
    expect(nerdleNumberFor(new Date(Date.UTC(2026, 10, 26, 12)))).toBe(1772);
    expect(globle.puzzleLabel(String(globleNumberFor(new Date(2026, 10, 26, 12))))).toBe("Nov 26");
  });

  it("agree with puzzleForDate", () => {
    expect(worldle.puzzleForDate([2026, 11, 26])).toBe("1770");
    expect(waffle.puzzleForDate([2026, 11, 26])).toBe("1770");
    expect(nerdle.puzzleForDate([2026, 11, 26])).toBe("1772");
  });
});

describe("parseWorldle", () => {
  it("reads the share, arrows and all", () => {
    const r = parseWorldle(
      "#Worldle #1770 (26.11.2026) 3/6 (100%)\n🟩🟩🟩⬛⬛↗️\n🟩🟩🟩🟩🟨⬅️\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr",
    );
    expect(r).toEqual({ ok: true, result: { puzzle: "1770", solved: true, guesses: 3, grid: ["ggg..", "ggggy", "ggggg"] } });
    expect(worldle.formatScore(r.ok ? r.result : ({} as never))).toBe("3/6");
  });

  it("reads a miss, light mode and a lifesaver", () => {
    const rows = Array(5).fill("🟩⬜⬜⬜⬜⬇️").concat("🟩🟩⬜⬜⬜🛟").join("\n");
    const r = parseWorldle(`#Worldle #1770 (26.11.2026) X/6 (40%) 🙈\n${rows}`);
    expect(r.ok && r.result).toMatchObject({ solved: false, guesses: null });
  });

  it("rejects grids that don't fit the score", () => {
    expect(parseWorldle("#Worldle #1770 (26.11.2026) 2/6 (100%)\n🟩🟩🟩🟩🟩🎉")).toMatchObject({ ok: false });
    expect(parseWorldle("#Worldle #1770 (26.11.2026) 1/6 (100%)")).toMatchObject({ ok: false, error: /grid/ });
  });
});

describe("parseGloble", () => {
  it("reads the date and guesses", () => {
    const r = parseGloble("🌎 Nov 26, 2026 🌍\n🔥 3 | Avg. Guesses: 5.2\n🟧🟨🟥🟩 = 4\n\nhttps://globle-game.com\n#globle");
    expect(r).toEqual({ ok: true, result: { puzzle: String(globleNumberFor(new Date(2026, 10, 26))), guesses: 4 } });
  });

  it("needs today's win", () => {
    expect(parseGloble("🌎 Nov 26, 2026 🌍\n🔥 0 | Avg. Guesses: --\n-- = --")).toMatchObject({ ok: false });
  });
});

describe("parseWaffle", () => {
  it("reads the stars", () => {
    const r = parseWaffle("#waffle1770 3/5\n\n🟩🟩🟩🟩⭐\n🟩⬜🟩⬜🟩\n🟩🟩⭐🟩🟩\n🟩⬜🟩⬜🟩\n⭐🟩🟩🟩🟩\n\n🔥 streak: 4\nwafflegame.net");
    expect(r).toEqual({ ok: true, result: { puzzle: "1770", solved: true, stars: 3 } });
    expect(waffle.formatScore(r.ok ? r.result : ({} as never))).toBe("3⭐");
  });

  it("reads a loss, and turns away Deluxe and Royale", () => {
    expect(parseWaffle("#waffle1770 X/5")).toEqual({ ok: true, result: { puzzle: "1770", solved: false, stars: null } });
    expect(parseWaffle("#waffleroyale12 3/5")).toMatchObject({ ok: false, error: /daily/ });
    expect(parseWaffle("#deluxewaffle12 3/5")).toMatchObject({ ok: false, error: /daily/ });
  });

  it("ranks more stars higher, and a loss last", () => {
    const [five, none, lost] = [5, 0, null].map((s) => ({ puzzle: "1", solved: s !== null, stars: s }));
    expect(waffle.compare(five, none)).toBeLessThan(0);
    expect(waffle.compare(none, lost)).toBeLessThan(0);
  });
});

describe("parseNerdle", () => {
  it("reads the share", () => {
    const r = parseNerdle("nerdlegame 1772 3/6\n\n⬛️🟪⬛️⬛️🟩⬛️🟪⬛️\n🟩🟩⬛️🟪🟩⬛️🟩🟩\n🟩🟩🟩🟩🟩🟩🟩🟩");
    expect(r).toEqual({
      ok: true,
      result: { puzzle: "1772", solved: true, guesses: 3, grid: [".p..g.p.", "gg.pg.gg", "gggggggg"] },
    });
  });

  it("turns away other modes and short rows", () => {
    expect(parseNerdle("mini nerdlegame 1772 3/6\n🟩🟩🟩🟩🟩🟩")).toMatchObject({ ok: false, error: /classic/ });
    expect(parseNerdle("nerdlegame 1772 1/6\n🟩🟩🟩🟩🟩")).toMatchObject({ ok: false, error: /8 squares/ });
  });
});
