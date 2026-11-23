import { describe, expect, it } from "vitest";
import { contexto, contextoNumberFor, manualContexto, parseContexto } from "./contexto";

describe("contextoNumberFor", () => {
  it("numbers days from 2022-09-18, by local date", () => {
    expect(contextoNumberFor(new Date(2022, 8, 18))).toBe(0);
    expect(contextoNumberFor(new Date(2026, 10, 23, 23, 59))).toBe(1527);
    expect(contexto.puzzleForDate([2026, 11, 23])).toBe("1527");
  });
});

describe("parseContexto", () => {
  it("reads a solve with hints, dated the way Contexto shares now", () => {
    const r = parseContexto(
      "I played contexto.me 11/23/2026 and got it in 24 guesses and 2 hints.\n\n🟩🟩 3\n🟨🟨🟨🟨 8\n🟥🟥🟥🟥🟥🟥 13",
    );
    expect(r).toEqual({ ok: true, result: { puzzle: "1527", solved: true, guesses: 24, hints: 2, chart: [3, 8, 13] } });
    expect(contexto.formatScore(r.ok ? r.result : ({} as never))).toBe("24 +2💡");
  });

  it("reads an older numbered share, Windows line breaks and empty bars", () => {
    const r = parseContexto("I played contexto.me #1,200 and got it in 1 guesses.\r\n\r\n🟩 1\r\n 0\r\n 0");
    expect(r).toEqual({ ok: true, result: { puzzle: "1200", solved: true, guesses: 1, hints: 0, chart: [1, 0, 0] } });
    expect(contexto.formatScore(r.ok ? r.result : ({} as never))).toBe("1");
  });

  it("reads giving up", () => {
    const r = parseContexto("I played contexto.me 11/23/2026 but I gave up in 30 guesses.\n\n 0\n🟨 4\n🟥🟥🟥 26");
    expect(r.ok && r.result).toMatchObject({ solved: false, guesses: 30, chart: [0, 4, 26] });
    expect(contexto.formatScore(r.ok ? r.result : ({} as never))).toBe("🏳️");
  });

  it("rejects anything else", () => {
    expect(parseContexto("Wordle 1,612 3/6").ok).toBe(false);
    expect(parseContexto("I played contexto.me Unlimited and got it in 5 guesses.\n\n🟩 1\n🟨 2\n🟥 2").ok).toBe(false);
    // No bars, bars that add up to more than the guesses, a solve with no green, a made-up date.
    expect(parseContexto("I played contexto.me 11/23/2026 and got it in 5 guesses.").ok).toBe(false);
    expect(parseContexto("I played contexto.me 11/23/2026 and got it in 5 guesses.\n\n🟩 1\n🟨 2\n🟥 9").ok).toBe(false);
    expect(parseContexto("I played contexto.me 11/23/2026 and got it in 5 guesses.\n\n 0\n🟨 2\n🟥 3").ok).toBe(false);
    expect(parseContexto("I played contexto.me 02/30/2026 and got it in 5 guesses.\n\n🟩 1\n🟨 2\n🟥 2").ok).toBe(false);
  });
});

describe("ranking", () => {
  it("ranks solves by guesses alone, and giving up is last and can't win", () => {
    const [best, hinted, slow, quit] = [
      manualContexto("1", 12),
      manualContexto("1", 12, 1),
      manualContexto("1", 40),
      manualContexto("1", null),
    ];
    expect(contexto.compare(best, hinted)).toBe(0);
    expect(contexto.compare(hinted, slow)).toBeLessThan(0);
    expect(contexto.compare(slow, quit)).toBeLessThan(0);
    expect(contexto.compare(manualContexto("1", 900), { ...quit, guesses: 3 })).toBeLessThan(0);
    // Everyone who gave up ties, whatever their guesses.
    expect(contexto.compare(quit, { ...quit, guesses: 3 })).toBe(0);
    expect(contexto.canWin(quit)).toBe(false);
    expect(contexto.average([best, slow, quit])).toBe("26.0");
    expect(contexto.average([quit])).toBeNull();
  });
});
