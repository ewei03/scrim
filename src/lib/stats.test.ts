import { describe, expect, it } from "vitest";
import { manualWordle, wordle, type WordleResult } from "@/games/wordle";
import { crewStats, h2hKey, type StatLobby } from "./stats";

function lobby(day: number, scores: Record<string, number | null>): StatLobby<WordleResult> {
  return {
    id: `l${day}`,
    invite_code: `code${day}`,
    puzzle_id: String(day),
    ended_at: new Date(Date.UTC(2026, 10, day)).toISOString(),
    entries: Object.entries(scores).map(([user_id, g]) => ({ user_id, result: manualWordle(String(day), g, false) })),
  };
}

describe("crewStats", () => {
  const lobbies = [
    lobby(1, { ann: 3, bob: 4 }),
    lobby(2, { ann: 2, bob: 2, cat: 5 }), // ann + bob co-win
    lobby(3, { bob: 3, cat: null }),
  ];
  const { players, h2h } = crewStats(wordle, lobbies, ["ann", "bob", "cat", "dan"]);
  const get = (id: string) => players.find((p) => p.userId === id)!;

  it("counts wins, games and streaks", () => {
    expect(get("bob")).toMatchObject({ played: 3, wins: 2, streak: 2, average: "3.00" });
    expect(get("ann")).toMatchObject({ played: 2, wins: 2, streak: 2, winRate: 1, average: "2.50" });
    expect(get("cat")).toMatchObject({ played: 2, wins: 0, streak: 0, average: "5.00" });
    expect(get("dan")).toMatchObject({ played: 0, wins: 0, average: null });
  });

  it("orders by wins, then win rate", () => {
    expect(players.map((p) => p.userId)).toEqual(["ann", "bob", "cat", "dan"]);
  });

  it("lists recent performances newest first", () => {
    expect(get("bob").recent.map((r) => [r.puzzleId, r.place, r.score])).toEqual([
      ["3", 1, "3/6"],
      ["2", 1, "2/6"],
      ["1", 2, "4/6"],
    ]);
  });

  it("tracks head-to-head records", () => {
    expect(h2h.get(h2hKey("ann", "bob"))).toEqual({ wins: 1, losses: 0, ties: 1 });
    expect(h2h.get(h2hKey("bob", "ann"))).toEqual({ wins: 0, losses: 1, ties: 1 });
    expect(h2h.get(h2hKey("bob", "cat"))).toEqual({ wins: 2, losses: 0, ties: 0 });
    expect(h2h.get(h2hKey("ann", "dan"))).toBeUndefined();
  });
});
