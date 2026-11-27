import { describe, expect, it } from "vitest";
import { angledle, angledleNumberFor, parseAngledle } from "@/games/angledle";
import { MODES, minecraftdle, minecraftdleNumberFor, parseMinecraftdle } from "@/games/minecraftdle";
import angledleCore from "./angledle-core.js";
import mcCore from "./minecraftdle-core.js";

// Save shapes from each site's own code, checked 2026-11-26.
describe("Minecraftdle", () => {
  const TODAY = 18;
  const guess = (name: string, ...states: string[]) => ({ name, states: ["incorrect", ...states] });
  const state = (over: object = {}) => ({
    now: 0,
    day: "2026-11-27",
    number: TODAY,
    status: "won",
    guesses: [
      guess("Dirt", "incorrect", "higher", "incorrect"),
      guess("Stone", "correct", "lower", "correct"),
      { name: "Obsidian", states: ["correct", "correct", "correct", "correct"] },
    ],
    stats: { currentStreak: 3 },
    ...over,
  });
  const save = (mode: string, s: object): [string, string] => [`minecraftdle:daily:${mode}`, JSON.stringify(s)];

  it("numbers days the same way the app does", () => {
    expect(mcCore.numberFromDate("2026-11-27")).toBe(TODAY);
    const at = Date.UTC(2026, 10, 26, 23, 30);
    expect(mcCore.numberFromDate(mcCore.madridDate(at))).toBe(minecraftdleNumberFor(new Date(at)));
  });

  it("finds each mode's won daily, without the names", () => {
    const games = mcCore.findFinishedGames([save("blocks", state()), save("mobs", state({ number: TODAY - 1, day: "2026-11-26" }))], TODAY);
    expect(games).toEqual([
      { game: "minecraftdle", puzzle: "18", guesses: 3, grid: ["xux", "cdc", "ccc"], streak: 3 },
      { game: "minecraftdlemob", puzzle: "17", guesses: 3, grid: ["xux", "cdc", "ccc"], streak: 3 },
    ]);
    expect(JSON.stringify(games)).not.toContain("Obsidian");
  });

  it("counts a game with guesses that had every trait right but the wrong name", () => {
    // From a real 14-try game: guesses 11 and 12 matched every trait but the name.
    const near = guess("Near", ...Array(8).fill("correct"));
    const guesses = [
      ...Array.from({ length: 10 }, () => guess("Miss", "incorrect", "lower", ...Array(6).fill("correct"))),
      near,
      near,
      guess("Close", "correct", "lower", ...Array(6).fill("correct")),
      { name: "Answer", states: Array(9).fill("correct") },
    ];
    const [g] = mcCore.findFinishedGames([save("blocks", state({ guesses }))], TODAY);
    expect(g).toMatchObject({ game: "minecraftdle", puzzle: "18", guesses: 14 });
    expect(g.grid.filter((r) => r === "cccccccc")).toHaveLength(3);
    // Its share stops at 10 rows, so only the tries are read back.
    expect(parseMinecraftdle(mcCore.shareText("minecraftdle", mcCore.toResult(g)), MODES[0])).toEqual({
      ok: true,
      result: { puzzle: "18", guesses: 14 },
    });
  });

  it("ignores games in progress, old days and broken saves", () => {
    expect(mcCore.findFinishedGames([save("blocks", state({ status: "playing" }))], TODAY)).toEqual([]);
    expect(mcCore.findFinishedGames([save("blocks", state({ number: 10, day: "2026-11-19" }))], TODAY)).toEqual([]);
    expect(mcCore.findFinishedGames([save("blocks", state({ guesses: [guess("Dirt", "incorrect")] }))], TODAY)).toEqual([]);
    expect(mcCore.findFinishedGames([["minecraftdle:daily:items", "{"]], TODAY)).toEqual([]);
  });

  it("writes a share the site's parser reads back", () => {
    const [g] = mcCore.findFinishedGames([save("blocks", state())], TODAY);
    const result = mcCore.toResult(g);
    expect(parseMinecraftdle(mcCore.shareText("minecraftdle", result), MODES[0])).toEqual({ ok: true, result });
    expect(mcCore.formatScore(result)).toBe(minecraftdle.formatScore(result));
  });
});

describe("Angledle", () => {
  const TODAY = 1790;
  const row = (guess: number, proximity: string, direction: string) => ({ guess, target: 200, difference: 0, proximity, direction });
  const save = (over: object = {}): [string, string][] => [
    ["adl-v1-stats-data", "{}"],
    [
      "adl-v1-game-state",
      JSON.stringify({
        guesses: [row(90, "far", "higher"), row(210, "close", "lower"), row(203, "very-close", "lower"), row(200, "exact", "correct")],
        status: "won",
        targetAngle: 200,
        puzzleNumber: TODAY,
        ...over,
      }),
    ],
  ];

  it("numbers days the same way the app does, starting at 6 am", () => {
    expect(angledleCore.numberAt(new Date(2026, 10, 26, 12).getTime())).toBe(TODAY);
    expect(angledleCore.numberAt(new Date(2026, 10, 26, 12).getTime())).toBe(angledleNumberFor(new Date(2026, 10, 26)));
    expect(angledleCore.numberAt(new Date(2026, 10, 27, 5, 59).getTime())).toBe(TODAY);
    expect(angledleCore.numberAt(new Date(2026, 10, 27, 6).getTime())).toBe(TODAY + 1);
  });

  it("finds the finished Guess, without the angles", () => {
    const games = angledleCore.findFinishedGames(save(), TODAY);
    expect(games).toEqual([{ puzzle: "1790", solved: true, guesses: 4, grid: ["ru", "yd", "gd", "gc"] }]);
    expect(JSON.stringify(games)).not.toContain("200");
  });

  it("finds a miss only after six guesses", () => {
    const five = Array.from({ length: 5 }, () => row(90, "far", "higher"));
    expect(angledleCore.findFinishedGames(save({ guesses: five, status: "lost" }), TODAY)).toEqual([]);
    const six = [...five, row(90, "far", "higher")];
    expect(angledleCore.findFinishedGames(save({ guesses: six, status: "lost" }), TODAY)).toMatchObject([
      { solved: false, guesses: 6 },
    ]);
  });

  it("ignores games in progress, old days and broken saves", () => {
    expect(angledleCore.findFinishedGames(save({ status: "playing" }), TODAY)).toEqual([]);
    expect(angledleCore.findFinishedGames(save({ puzzleNumber: TODAY - 5 }), TODAY)).toEqual([]);
    expect(angledleCore.findFinishedGames([["adl-v1-game-state", "{"]], TODAY)).toEqual([]);
  });

  it("writes a share the site's parser reads back", () => {
    const [g] = angledleCore.findFinishedGames(save(), TODAY);
    const result = angledleCore.toResult(g);
    expect(parseAngledle(angledleCore.shareText(result))).toEqual({ ok: true, result });
    expect(angledleCore.formatScore(result)).toBe(angledle.formatScore(result));
  });
});
