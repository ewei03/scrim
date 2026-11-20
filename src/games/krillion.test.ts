import { describe, expect, it } from "vitest";
import { nextMidnightIn } from "@/lib/time";
import { rankEntries } from "./ranking";
import { krillion, krillionNumberFor, manualKrillion, parseKrillion } from "./krillion";

describe("krillionNumberFor", () => {
  it("counts dives by New York date", () => {
    expect(krillionNumberFor(new Date("2026-07-16T12:00:00Z"))).toBe(1);
    expect(krillionNumberFor(new Date("2026-11-19T12:00:00Z"))).toBe(127);
    // 03:00 UTC on the 20th is still the 19th in New York (UTC-5).
    expect(krillionNumberFor(new Date("2026-11-20T03:00:00Z"))).toBe(127);
    expect(krillionNumberFor(new Date("2026-11-20T05:00:00Z"))).toBe(128);
  });

  it("resets at New York midnight, across DST", () => {
    expect(nextMidnightIn("America/New_York", new Date("2026-11-19T12:00:00Z")).toISOString()).toBe(
      "2026-11-20T05:00:00.000Z",
    );
    expect(nextMidnightIn("America/New_York", new Date("2026-07-16T12:00:00Z")).toISOString()).toBe(
      "2026-07-17T04:00:00.000Z",
    );
    // The day DST ends (Nov 1 2026): midnight after is EST.
    expect(nextMidnightIn("America/New_York", new Date("2026-11-01T12:00:00Z")).toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
  });
});

describe("parseKrillion", () => {
  it("scores from the tiers, whatever the score line says", () => {
    const r = parseKrillion("Krillion #127 🦐\n3,600m · whatever\n🐟🫧🦑⬛🌟🐟🏮\nkrillion.io");
    expect(r).toEqual({ ok: true, result: { puzzle: "127", points: 315, tiers: "spr" + "xksd" } });
    expect(krillion.formatScore(r.ok ? r.result : ({} as never))).toBe("315");
  });

  it("handles variation selectors and rejects incomplete or Unlimited results", () => {
    expect(parseKrillion("Krillion #5 🦐\n🌟️🌟️🌟️🌟️🌟️🌟️🌟️").ok && true).toBe(true);
    expect(parseKrillion("Krillion #5 🦐\n🌟🌟🌟").ok).toBe(false);
    expect(parseKrillion("Krillion ∞ 🦐\n🌟🌟🌟🌟🌟🌟🌟")).toMatchObject({ ok: false, error: /Unlimited/ });
    expect(parseKrillion("Connections\nPuzzle #1").ok).toBe(false);
    // Answers split over two lines, or with extra text on the line.
    expect(parseKrillion("Krillion #5 🦐\n🌟🌟🌟\n🌟🌟🌟🌟")).toMatchObject({ ok: false, error: /one line/ });
    expect(parseKrillion("Krillion #5 🦐\n🌟🌟🌟🌟🌟🌟🌟 lol")).toMatchObject({ ok: false, error: /something other/ });
  });
});

it("ranks the deepest dive first, and a scoreless dive can't win", () => {
  const ranked = rankEntries(krillion, [
    { id: "a", result: manualKrillion("1", 300) },
    { id: "b", result: manualKrillion("1", 450) },
    { id: "c", result: manualKrillion("1", 450) },
  ]);
  expect(ranked.map((r) => [r.id, r.place, r.winner])).toEqual([
    ["b", 1, true],
    ["c", 1, true],
    ["a", 3, false],
  ]);
  expect(rankEntries(krillion, [{ id: "z", result: manualKrillion("1", 0) }])[0].winner).toBe(false);
});
