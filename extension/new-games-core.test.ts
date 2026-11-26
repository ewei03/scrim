import { describe, expect, it } from "vitest";
import { globle, globleNumberFor, parseGloble } from "@/games/globle";
import { nerdle, nerdleNumberFor, parseNerdle } from "@/games/nerdle";
import { parseWaffle, waffle, waffleNumberFor } from "@/games/waffle";
import { parseWorldle, worldle, worldleNumberFor } from "@/games/worldle";
import globleCore from "./globle-core.js";
import nerdleCore from "./nerdle-core.js";
import waffleCore from "./waffle-core.js";
import worldleCore from "./worldle-core.js";

// Save shapes from each site's own code, checked 2026-11-26.
const NOW = Date.UTC(2026, 10, 26, 12);

describe("Worldle", () => {
  const save = (days: Record<string, number[]>): [string, string][] => [
    ["guesses", JSON.stringify(Object.fromEntries(Object.entries(days).map(([d, ds]) => [d, ds.map((distance) => ({ name: "X", distance, direction: "N" }))])))],
    ["settings", "{}"],
  ];
  const today = worldleCore.numberFromDate("2026-11-26");

  it("numbers days the same way the app does", () => {
    expect(today).toBe(worldleNumberFor(new Date(2026, 10, 26)));
  });

  it("draws closeness the way the share does", () => {
    expect(worldleCore.rowOf(0)).toBe("ggggg");
    expect(worldleCore.rowOf(1_000_000)).toBe("ggggy"); // 95%
    expect(worldleCore.rowOf(19_000_000)).toBe("....."); // 5%
    expect(worldleCore.rowOf(30_000_000)).toBe(".....");
  });

  it("reads today's and yesterday's finished rounds only", () => {
    const games = worldleCore.findFinishedGames(
      save({ "2026-11-26": [5_000_000, 1_000_000, 0], "2026-11-25": [1, 2, 3, 4, 5, 6], "2026-11-20": [0], "2026-11-24": [0] }),
      today,
    );
    expect(games.map((g) => [g.puzzle, g.solved, g.guesses])).toEqual([
      [String(today), true, 3],
      [String(today - 1), false, 6],
    ]);
  });

  it("waits for the round to end", () => {
    expect(worldleCore.findFinishedGames(save({ "2026-11-26": [5_000_000] }), today)).toEqual([]);
    expect(worldleCore.findFinishedGames([["guesses", "{oops"]], today)).toEqual([]);
  });

  it("builds results whose share text the app can parse", () => {
    const [g] = worldleCore.findFinishedGames(save({ "2026-11-26": [5_000_000, 1_000_000, 0] }), today);
    const result = worldleCore.toResult(g);
    expect(parseWorldle(worldleCore.shareText(result))).toEqual({ ok: true, result });
    expect(worldleCore.formatScore(result)).toBe(worldle.formatScore(result));
  });
});

describe("Globle", () => {
  const save = (day: string, lastWin: string, used: number[]): [string, string][] => [
    ["guesses", JSON.stringify({ countries: ["Peru", "Chile"], day })],
    ["statistics", JSON.stringify({ gamesWon: used.length, lastWin, currentStreak: 1, maxStreak: 1, usedGuesses: used, emojiGuesses: "" })],
  ];

  it("reads today's win", () => {
    expect(globleCore.findFinishedGames(save("2026-11-26", "2026-11-26", [9, 4]), "2026-11-26")).toEqual([
      { puzzle: String(globleNumberFor(new Date(2026, 10, 26))), guesses: 4, day: "2026-11-26" },
    ]);
  });

  it("ignores a game not won today", () => {
    expect(globleCore.findFinishedGames(save("2026-11-26", "2026-11-25", [9, 4]), "2026-11-26")).toEqual([]);
    expect(globleCore.findFinishedGames(save("2026-11-25", "2026-11-25", [4]), "2026-11-26")).toEqual([]);
  });

  it("builds results whose share text the app can parse", () => {
    const [g] = globleCore.findFinishedGames(save("2026-11-26", "2026-11-26", [7]), "2026-11-26");
    const result = globleCore.toResult(g);
    expect(parseGloble(globleCore.shareText(result))).toEqual({ ok: true, result });
    expect(globleCore.formatScore(result)).toBe(globle.formatScore(result));
  });
});

describe("Waffle", () => {
  const letters = "SWEETTDEONIONOCSLATTE".split("");
  const save = (over: object): [string, string][] => [
    ["state", JSON.stringify({ solution: letters, puzzle: [...letters].reverse(), swapsRemaining: 15, gameNumber: 1770, ...over })],
  ];
  const today = waffleCore.numberAt(NOW);

  it("numbers days the same way the app does", () => {
    expect(today).toBe(waffleNumberFor(new Date(NOW)));
    expect(today).toBe(1770);
  });

  it("reads a solve's stars, and a loss", () => {
    expect(waffleCore.findFinishedGames(save({ puzzle: letters, swapsRemaining: 3 }), today)).toEqual([
      { puzzle: "1770", solved: true, stars: 3 },
    ]);
    expect(waffleCore.findFinishedGames(save({ swapsRemaining: 0 }), today)).toEqual([
      { puzzle: "1770", solved: false, stars: null },
    ]);
  });

  it("waits for the game to end, and ignores old days", () => {
    expect(waffleCore.findFinishedGames(save({ swapsRemaining: 4 }), today)).toEqual([]);
    expect(waffleCore.findFinishedGames(save({ puzzle: letters, gameNumber: 1700 }), today)).toEqual([]);
  });

  it("builds results whose share text the app can parse", () => {
    const [g] = waffleCore.findFinishedGames(save({ puzzle: letters, swapsRemaining: 5 }), today);
    const result = waffleCore.toResult(g);
    expect(parseWaffle(waffleCore.shareText(result))).toEqual({ ok: true, result });
    expect(waffleCore.formatScore(result)).toBe(waffle.formatScore(result));
  });
});

describe("Nerdle", () => {
  const save = (guesses: string[], over: object = {}, mode = ""): [string, string][] => [
    ["gameMode", mode],
    ["gameState", JSON.stringify({ guesses, solution: "12+35=47", gameMode: "", solutionIndex: 1757, ...over })],
  ];
  const today = nerdleCore.numberAt(NOW);

  it("numbers days the same way the app does", () => {
    expect(today).toBe(nerdleNumberFor(new Date(NOW)));
    expect(today).toBe(1758);
  });

  it("colours guesses the way Nerdle does", () => {
    expect(nerdleCore.rowOf("12+35=47", "12+35=47")).toBe("gggggggg");
    expect(nerdleCore.rowOf("21+53=74", "12+35=47")).toBe("ppgppgpp");
    // Each answer character counts once: only the first spare "2" is purple.
    expect(nerdleCore.rowOf("11+11=22", "12+35=47")).toBe("g.g..gp.");
  });

  it("reads a finished classic game", () => {
    expect(nerdleCore.findFinishedGames(save(["10+20=30", "12+35=47"]), today)).toMatchObject([
      { puzzle: "1758", solved: true, guesses: 2 },
    ]);
    const lost = Array(6).fill("10+20=30");
    expect(nerdleCore.findFinishedGames(save(lost), today)).toMatchObject([{ solved: false, guesses: 6 }]);
  });

  it("ignores games in progress, other modes and old days", () => {
    expect(nerdleCore.findFinishedGames(save(["10+20=30"]), today)).toEqual([]);
    expect(nerdleCore.findFinishedGames(save(["12+35=47"], {}, "mini"), today)).toEqual([]);
    expect(nerdleCore.findFinishedGames(save(["12+35=47"], { solutionIndex: 1700 }), today)).toEqual([]);
  });

  it("builds results whose share text the app can parse", () => {
    const [g] = nerdleCore.findFinishedGames(save(["21+53=74", "12+35=47"]), today);
    const result = nerdleCore.toResult(g);
    expect(parseNerdle(nerdleCore.shareText(result))).toEqual({ ok: true, result });
    expect(nerdleCore.formatScore(result)).toBe(nerdle.formatScore(result));
  });
});
