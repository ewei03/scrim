import { describe, expect, it } from "vitest";
import { parseConnections } from "@/games/connections";
import core from "./connections-core.js";

// Shapes from NYT's Connections code: guesses hold card positions, and the
// day's puzzle file says which category (level) each position belongs to.
const PUZZLE = {
  categories: [
    { title: "Y", cards: [1, 7, 12, 15].map((position) => ({ content: "w", position })) },
    { title: "G", cards: [3, 8, 10, 14].map((position) => ({ content: "w", position })) },
    { title: "B", cards: [2, 4, 9, 11].map((position) => ({ content: "w", position })) },
    { title: "P", cards: [0, 5, 6, 13].map((position) => ({ content: "w", position })) },
  ],
};
const g = (cards: string, correct: boolean) => ({ cards, correct });
const saved = (data: Record<string, unknown>, printDate = "2024-07-18") =>
  JSON.stringify({
    states: [{ puzzleId: "1373", printDate, schemaVersion: "0.52.0", data: { isPlayingArchive: false, ...data } }],
  });

// Solved with one mistake; saved right after the last guess, before puzzleComplete flipped.
const WIN = {
  puzzleComplete: false,
  puzzleWon: false,
  mistakes: 1,
  solvedCategories: [{ title: "Y", level: 0, cards: "1,7,12,15" }],
  guesses: [g("1,7,12,15", true), g("3,8,9,14", false), g("3,8,10,14", true), g("2,4,9,11", true), g("0,5,6,13", true)],
};
const LOSS = {
  puzzleComplete: true,
  puzzleWon: false,
  mistakes: 4,
  solvedCategories: [{ title: "Y", level: 0, cards: "1,7,12,15" }],
  guesses: [g("1,7,12,15", true), g("3,8,9,14", false), g("0,8,9,14", false), g("2,4,5,11", false), g("0,6,10,13", false)],
};

describe("findFinishedGames", () => {
  it("treats four correct guesses as finished even before puzzleComplete is saved", () => {
    const [game] = core.findFinishedGames([["games-state-connections/ANON", saved(WIN)]]);
    expect(game).toMatchObject({ puzzle: "403", printDate: "2024-07-18", solved: true, mistakes: 1, groups: 4 });
  });

  it("marks signed-out saves, and prefers the signed-in save for the same puzzle", () => {
    const loss = { ...LOSS, puzzleComplete: true };
    expect(core.findFinishedGames([["games-state-connections/ANON", saved(WIN)]])[0]).toMatchObject({
      signedIn: false,
      account: null,
    });
    for (const order of [
      [
        ["games-state-connections/ANON", saved(WIN)],
        ["games-state-connections/12345", saved(loss)],
      ],
      [
        ["games-state-connections/12345", saved(loss)],
        ["games-state-connections/ANON", saved(WIN)],
      ],
    ] as [string, string][][]) {
      const games = core.findFinishedGames(order);
      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({ signedIn: true, account: "12345", solved: false });
    }
  });

  it("reads losses and the signed-in collection key", () => {
    const [game] = core.findFinishedGames([["games-state-connections-collection/123", saved(LOSS)]]);
    expect(game).toMatchObject({ solved: false, mistakes: 4, groups: 1 });
  });

  it("skips unfinished games, archive games and other keys", () => {
    const halfway = { ...WIN, guesses: WIN.guesses.slice(0, 3) };
    expect(
      core.findFinishedGames([
        ["games-state-connections/1", saved(halfway)],
        ["games-state-connections/2", saved({ ...WIN, isPlayingArchive: true })],
        ["games-state-wordleV2/ANON", saved(WIN)],
        ["games-state-connections/3", "{not json"],
      ]),
    ).toEqual([]);
  });

  it("falls back to today's date when there's no printDate", () => {
    const [game] = core.findFinishedGames([["games-state-connections/ANON", saved(WIN, "")]], new Date(2024, 6, 18, 9));
    expect(game).toMatchObject({ puzzle: "403", printDate: "2024-07-18" });
  });
});

describe("toResult", () => {
  const find = (data: Record<string, unknown>) => core.findFinishedGames([["games-state-connections/ANON", saved(data)]])[0];

  it("colours the grid from the puzzle file, and the share text parses", () => {
    const result = core.toResult(find(WIN), core.levelsFromPuzzle(PUZZLE));
    expect(result).toEqual({
      puzzle: "403",
      solved: true,
      mistakes: 1,
      groups: 4,
      grid: ["yyyy", "ggbg", "gggg", "bbbb", "pppp"],
    });
    expect(parseConnections(core.shareText(result))).toEqual({ ok: true, result });
  });

  it("colours a loss too", () => {
    expect(core.toResult(find(LOSS), core.levelsFromPuzzle(PUZZLE))).toMatchObject({
      solved: false,
      mistakes: 4,
      groups: 1,
      grid: ["yyyy", "ggbg", "pgbg", "bbpb", "ppgp"],
    });
  });

  it("sends just the score when the puzzle file couldn't be loaded", () => {
    expect(core.toResult(find(WIN), new Map())).toEqual({ puzzle: "403", solved: true, mistakes: 1, groups: 4 });
    expect(core.toResult(find(LOSS), core.levelsFromPuzzle(null))).toEqual({
      puzzle: "403",
      solved: false,
      mistakes: 4,
      groups: 1,
    });
  });
});
