import { describe, expect, it } from "vitest";
import { rankEntries } from "./ranking";
import { customAdapter, formatTime, parseTime, type CustomGame } from "./custom";

const base: CustomGame = {
  id: "abc",
  crew_id: "c",
  name: "Golf",
  url: null,
  instructions: null,
  color: "#4fc1a6",
  score_type: "points",
  higher_is_better: false,
  decimals: 0,
  unit: "strokes",
  time_format: null,
  max_attempts: null,
  allow_fail: true,
  created_at: "",
};

describe("custom games", () => {
  it("numbers days from 2020-01-01 and labels them by date", () => {
    const g = customAdapter(base);
    expect(g.puzzleForDate([2020, 1, 1])).toBe("0");
    expect(g.puzzleForDate([2026, 11, 20])).toBe("2515");
    expect(g.puzzleLabel("2515")).toBe("Nov 20");
    expect(g.id).toBe("custom:abc");
  });

  it("ranks by the game's direction, and a 'didn't finish' last and can't win", () => {
    const g = customAdapter(base);
    const ranked = rankEntries(g, [
      { id: "a", result: { puzzle: "1", value: 72 } },
      { id: "b", result: { puzzle: "1", value: 65 } },
      { id: "c", result: { puzzle: "1", failed: true } },
    ]);
    expect(ranked.map((r) => [r.id, r.place, r.winner])).toEqual([
      ["b", 1, true],
      ["a", 2, false],
      ["c", 3, false],
    ]);
    const high = customAdapter({ ...base, higher_is_better: true });
    expect(rankEntries(high, [{ id: "a", result: { puzzle: "1", value: 72 } }, { id: "b", result: { puzzle: "1", value: 65 } }])[0].id).toBe("a");
  });

  it("formats each score type", () => {
    expect(customAdapter(base).formatScore({ puzzle: "1", value: 1234 })).toBe("1,234 strokes");
    expect(customAdapter({ ...base, unit: null, decimals: 2 }).formatScore({ puzzle: "1", value: 3.5 })).toBe("3.50");
    const time = customAdapter({ ...base, score_type: "time", time_format: "m:ss.s" });
    expect(time.formatScore({ puzzle: "1", value: 83.4 })).toBe("1:23.4");
    expect(time.formatScore({ puzzle: "1", failed: true })).toBe("DNF");
    const tries = customAdapter({ ...base, score_type: "attempts", max_attempts: 6 });
    expect(tries.formatScore({ puzzle: "1", value: 4 })).toBe("4/6");
    expect(tries.formatScore({ puzzle: "1", failed: true })).toBe("X/6");
    expect(customAdapter({ ...base, score_type: "attempts" }).formatScore({ puzzle: "1", value: 1 })).toBe("1 try");
  });

  it("reads and writes times", () => {
    expect(parseTime("4:05")).toBe(245);
    expect(parseTime("1:04:05")).toBe(3845);
    expect(parseTime("90")).toBe(90);
    expect(parseTime("4:05.3")).toBeCloseTo(245.3);
    expect(parseTime("4:75")).toBeNull();
    expect(parseTime("soon")).toBeNull();
    expect(formatTime(3845, "h:mm:ss")).toBe("1:04:05");
    expect(formatTime(3845, "m:ss")).toBe("64:05");
  });
});
