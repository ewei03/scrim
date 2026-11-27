import { describe, expect, it } from "vitest";
import { manualWordle, wordle, type WordleResult } from "@/games/wordle";
import { crewStats, type StatRound } from "./stats";

function round(day: number, scores: Record<string, number | null>): StatRound<WordleResult> {
  return {
    id: `r${day}`,
    closes_at: new Date(Date.UTC(2026, 10, day)).toISOString(),
    entries: Object.entries(scores).map(([user_id, g]) => ({ user_id, result: manualWordle(String(day), g, false) })),
  };
}

describe("crewStats", () => {
  const rounds = [
    round(3, { bob: 3, cat: null }),
    round(1, { ann: 3, bob: 4 }),
    round(2, { ann: 2, bob: 2, cat: 5 }), // ann + bob co-win
  ];
  const { players } = crewStats(wordle, rounds, ["ann", "bob", "cat", "dan"]);
  const get = (id: string) => players.find((p) => p.userId === id)!;

  it("counts wins, games and streaks", () => {
    expect(get("bob")).toMatchObject({ played: 3, wins: 2, streak: 2, average: "3.00" });
    // Ann skipped day 3, which ends her streak but not her win rate.
    expect(get("ann")).toMatchObject({ played: 2, wins: 2, streak: 0, maxStreak: 2, winRate: 1, average: "2.50" });
    expect(get("cat")).toMatchObject({ played: 2, wins: 0, streak: 0, average: "5.00" });
    expect(get("dan")).toMatchObject({ played: 0, wins: 0, average: null });
  });

  it("finds the longest streak, even when it has ended", () => {
    const rounds = [
      round(1, { ann: 2, bob: 3 }),
      round(2, { ann: 2, bob: 3 }),
      round(3, { ann: 2, bob: 3 }),
      round(4, { ann: 4, bob: 3 }),
      round(5, { ann: 2, bob: 3 }),
    ];
    const { players } = crewStats(wordle, rounds, ["ann", "bob"]);
    expect(players.find((p) => p.userId === "ann")).toMatchObject({ streak: 1, maxStreak: 3 });
    expect(players.find((p) => p.userId === "bob")).toMatchObject({ streak: 0, maxStreak: 1 });
  });

  it("breaks a streak on a skipped day", () => {
    const rounds = [
      round(1, { ann: 2, bob: 3 }),
      round(2, { ann: 2, bob: 3 }),
      round(3, { bob: 3 }),
      round(4, { ann: 2, bob: 3 }),
    ];
    const { players } = crewStats(wordle, rounds, ["ann", "bob"], { byWinRate: true });
    expect(players.find((p) => p.userId === "ann")).toMatchObject({ played: 3, wins: 3, streak: 1, maxStreak: 2 });
  });

  it("orders by wins, then win rate", () => {
    expect(players.map((p) => p.userId)).toEqual(["ann", "bob", "cat", "dan"]);
  });
});

describe("crewStats ranked by win rate", () => {
  // Ann plays once and wins; Bob plays every day and wins twice.
  const rounds = [round(1, { ann: 2, bob: 3 }), round(2, { bob: 3, cat: 4 }), round(3, { bob: 2, cat: 5 })];
  const order = (byWinRate: boolean) =>
    crewStats(wordle, rounds, ["ann", "bob", "cat"], { byWinRate }).players.map((p) => p.userId);

  it("puts the most wins first by default", () => {
    expect(order(false)).toEqual(["bob", "ann", "cat"]);
  });

  it("puts the best win rate first with the rule on, so skipped days don't count against you", () => {
    expect(order(true)).toEqual(["ann", "bob", "cat"]);
  });
});
