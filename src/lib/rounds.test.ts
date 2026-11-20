import { describe, expect, it } from "vitest";
import { connections } from "@/games/connections";
import { krillion, krillionNumberFor } from "@/games/krillion";
import { wordle } from "@/games/wordle";
import { crewDeadline, crewPuzzle } from "./rounds";

describe("crew days", () => {
  // 03:00 UTC on Nov 20: still Nov 19 in New York, already Nov 20 in Tokyo.
  const now = new Date("2026-11-20T03:00:00Z");
  const ny = { timezone: "America/New_York" };
  const tokyo = { timezone: "Asia/Tokyo" };

  it("picks the puzzle by the crew's date", () => {
    expect(Number(crewPuzzle(wordle, tokyo, now)) - Number(crewPuzzle(wordle, ny, now))).toBe(1);
    expect(crewPuzzle(wordle, { timezone: "UTC" }, now)).toBe(crewPuzzle(wordle, tokyo, now));
    expect(crewPuzzle(connections, ny, new Date("2023-06-12T12:00:00Z"))).toBe("1");
  });

  it("uses New York time for Krillion whatever the crew's zone", () => {
    expect(crewPuzzle(krillion, tokyo, now)).toBe(String(krillionNumberFor(now)));
    expect(crewDeadline(krillion, tokyo, now)).toEqual(new Date("2026-11-20T05:00:00Z"));
  });

  it("ends the day at midnight in the crew's zone", () => {
    expect(crewDeadline(wordle, ny, now)).toEqual(new Date("2026-11-20T05:00:00Z"));
    expect(crewDeadline(wordle, tokyo, now)).toEqual(new Date("2026-11-20T15:00:00Z"));
  });
});
