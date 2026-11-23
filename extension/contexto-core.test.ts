import { describe, expect, it } from "vitest";
import { contextoNumberFor, parseContexto } from "@/games/contexto";
import core from "./contexto-core.js";

// Shapes from contexto.me's own code.
const history = (distances: number[]) => distances.map((distance, i) => ({ word: `w${i}`, distance }));
const save = (games: Record<string, unknown>) => JSON.stringify(games);
const game = (over: Record<string, unknown>) => ({
  gameId: 1527,
  guessHistory: history([0, 120, 900, 2400, 5000]),
  lastGuess: null,
  foundWord: "",
  numberOfTips: 0,
  numberOfAttempts: 5,
  gaveUp: "",
  postGameHistory: [],
  ...over,
});

describe("findFinishedGames", () => {
  it("reads today's and yesterday's finished games, newest first", () => {
    const entries: [string, string][] = [
      [
        "contexto-games-en",
        save({
          "1527": game({ foundWord: "plant", numberOfTips: 1 }),
          "1526": game({ gameId: 1526, gaveUp: "house" }),
          "1400": game({ gameId: 1400, foundWord: "old" }), // an archive game
          "1525": game({ gameId: 1525, foundWord: "x" }), // too old to count anywhere
        }),
      ],
      ["contexto-games-pt", save({ "1527": game({ foundWord: "planta" }) })],
    ];
    expect(core.findFinishedGames(entries, 1527, "uid-1")).toEqual([
      { puzzle: "1527", solved: true, guesses: 5, hints: 1, chart: [2, 1, 2], account: "uid-1" },
      { puzzle: "1526", solved: false, guesses: 5, hints: 0, chart: [2, 1, 2], account: "uid-1" },
    ]);
  });

  it("ignores games still being played, and bad saves", () => {
    expect(core.findFinishedGames([["contexto-games-en", save({ "1527": game({}) })]], 1527)).toEqual([]);
    expect(core.findFinishedGames([["contexto-games-en", "{oops"]], 1527)).toEqual([]);
    expect(core.findFinishedGames([], 1527)).toEqual([]);
  });

  it("numbers games the same way the app does", () => {
    expect(core.numberFromDate("2026-11-23")).toBe(contextoNumberFor(new Date(2026, 10, 23)));
    expect(core.shareDate("1527")).toBe("11/23/2026");
  });
});

it("builds results whose share text the app can parse", () => {
  const games: { solved: boolean; guesses: number; hints: number; chart: [number, number, number] }[] = [
    { solved: true, guesses: 24, hints: 2, chart: [3, 8, 13] },
    { solved: false, guesses: 300, hints: 0, chart: [0, 40, 260] },
    { solved: true, guesses: 1, hints: 0, chart: [1, 0, 0] },
  ];
  for (const g of games) {
    const result = core.toResult({ puzzle: "1527", ...g });
    expect(parseContexto(core.shareText(result))).toEqual({ ok: true, result });
  }
});
