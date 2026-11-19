import { describe, expect, it } from "vitest";
import { ordinal, timeLeft } from "./time";

describe("time helpers", () => {
  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1ST", "2ND", "3RD", "4TH", "11TH", "12TH", "13TH", "21ST", "22ND", "101ST", "111TH",
    ]);
  });
  it("formats time left", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(timeLeft(new Date(now + 252 * 60_000).toISOString(), now)).toBe("4h 12m");
    expect(timeLeft(new Date(now + 30_000).toISOString(), now)).toBe("<1m");
    expect(timeLeft(new Date(now + 50 * 3_600_000).toISOString(), now)).toBe("2d 2h");
  });
});
