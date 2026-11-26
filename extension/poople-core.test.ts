import { describe, expect, it } from "vitest";
import { parsePoople, poople, poopleNumberFor } from "@/games/poople";
import core from "./poople-core.js";

// Shapes from poople.io's own code.
const NOW = Date.UTC(2026, 10, 23, 12); // Poople #466
const save = (words: string[], opened = NOW): [string, string][] => [
  ["guesses", JSON.stringify(words)],
  ["dateLastPlayed", JSON.stringify(opened)],
  ["streak", "3"],
];
const WORDS = ["BOOT", "boop", "poop"];

describe("findFinishedGames", () => {
  it("reads today's path once it reaches POOP", () => {
    expect(core.findFinishedGames(save(WORDS), 2, NOW)).toEqual([
      { puzzle: "466", guesses: 2, best: 2, grid: [".pp.", ".ppp", "pppp"] },
    ]);
  });

  it("waits for POOP and the shortest path, and ignores an old day's save", () => {
    expect(core.findFinishedGames(save(["boot", "boop"]), 2, NOW)).toEqual([]);
    expect(core.findFinishedGames(save(WORDS), null, NOW)).toEqual([]);
    expect(core.findFinishedGames(save(WORDS, NOW - 86400000), 2, NOW)).toEqual([]);
    expect(core.findFinishedGames([["guesses", "{oops"]], 2, NOW)).toEqual([]);
  });

  it("reads the shortest path from the page", () => {
    expect(core.bestFrom("You used 5 guesses.The best solution was 4 guesses.Copy results")).toBe(4);
    expect(core.bestFrom(undefined)).toBeNull();
  });

  it("numbers puzzles the same way the app does", () => {
    expect(core.numberAt(NOW)).toBe(poopleNumberFor(new Date(NOW)));
  });
});

it("builds results whose share text the app can parse", () => {
  const [g] = core.findFinishedGames(save(["slot", "plot", "plop", "poop"]), 2, NOW);
  const result = core.toResult(g);
  expect(parsePoople(core.shareText(result))).toEqual({ ok: true, result });
  expect(core.formatScore(result)).toBe(poople.formatScore(result));
  expect(core.formatScore(result)).toBe("3");
});
