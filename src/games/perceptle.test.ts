import { describe, expect, it } from "vitest";
import { grade, parsePerceptle, perceptle, perceptleNumberFor } from "./perceptle";

// Share text from perceptle.com's code, checked 2026-11-26.
describe("Perceptle", () => {
  it("numbers days by local date, #1 on 2026-07-18", () => {
    expect(perceptleNumberFor(new Date(2026, 6, 18, 12))).toBe(1);
    expect(perceptleNumberFor(new Date(2026, 10, 26, 12))).toBe(132);
    expect(perceptle.puzzleForDate([2026, 11, 26])).toBe("132");
  });

  it("reads the share", () => {
    const text = "Perceptle #132 - B (78)\n🔢 80  🎯 70  📐 90  🥁 60  ✂️ 91\nhttps://perceptle.com";
    expect(parsePerceptle(text)).toEqual({ ok: true, result: { puzzle: "132", total: 78, events: [80, 70, 90, 60, 91] } });
  });

  it("reads the text the site copied in a real game (Windows line breaks)", () => {
    const text = "Perceptle #132 - F (21)\r\n🔢 100  🎯 5  📐 0  🥁 0  ✂️ 0\r\nhttps://perceptle.com";
    expect(parsePerceptle(text)).toEqual({ ok: true, result: { puzzle: "132", total: 21, events: [100, 5, 0, 0, 0] } });
  });

  it("reads Friday's harder share, and without the variation selector", () => {
    const text = "Perceptle #133 🃏 - S (100)\n🔢 100  🎯 100  📐 100  🥁 100  ✂ 100\nhttps://perceptle.com";
    expect(parsePerceptle(text)).toMatchObject({ ok: true, result: { puzzle: "133", total: 100 } });
  });

  it("rejects shares that don't add up or are cut short", () => {
    expect(parsePerceptle("Perceptle #132 - A (90)\n🔢 80  🎯 70  📐 90  🥁 60  ✂️ 91")).toMatchObject({ ok: false, error: /add up/ });
    expect(parsePerceptle("Perceptle #132 - B (78)\n🔢 80  🎯 70  📐 90")).toMatchObject({ ok: false, error: /five/ });
    expect(parsePerceptle("Perceptle #132 - B (78)\n🔢 80  🎯 70  📐 190  🥁 60  ✂️ 91")).toMatchObject({ ok: false });
    expect(parsePerceptle("Wordle 1,234 3/6")).toMatchObject({ ok: false, error: /Invalid format/ });
  });

  it("ranks the higher score first, and every result can win", () => {
    const a = { puzzle: "1", total: 90 };
    const b = { puzzle: "1", total: 70 };
    expect(perceptle.compare(a, b)).toBeLessThan(0);
    expect(perceptle.canWin({ puzzle: "1", total: 0 })).toBe(true);
    expect(perceptle.formatScore(a)).toBe("90 A");
    expect(perceptle.average([a, b])).toBe("80.0");
  });

  it("grades like the site", () => {
    expect([95, 94, 85, 70, 55, 40, 39].map(grade)).toEqual(["S", "A", "A", "B", "C", "D", "F"]);
  });
});
