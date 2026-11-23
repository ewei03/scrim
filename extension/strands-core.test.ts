import { describe, expect, it } from "vitest";
import { parseStrands, strandsNumberFor } from "@/games/strands";
import core from "./strands-core.js";

// Shapes from NYT's saved Strands state.
const h = (t: string) => ({ t, w: "WORD" });
const HISTORY = ["HINT", "THEME", "THEME", "THEME", "SPANGRAM", "HINT", "THEME", "THEME", "THEME"].map(h);
const saved = (data: Record<string, unknown>, printDate = "2026-11-23") =>
  JSON.stringify({
    states: [{ puzzleId: "1194", printDate, schemaVersion: "x", timestamp: 1, data: { isPlayingArchive: false, ...data } }],
  });

describe("findFinishedGames", () => {
  it("reads a solved game, numbered by its date, with its account", () => {
    const games = core.findFinishedGames([
      ["games-state-strands/123456", saved({ history: HISTORY, otherWordsFound: [], isSolved: true })],
    ]);
    expect(games).toEqual([
      { signedIn: true, account: "123456", puzzle: "995", printDate: "2026-11-23", grid: "hbbbshbbb" },
    ]);
  });

  it("prefers a signed-in save, and ignores unfinished, archive and unreadable games", () => {
    const games = core.findFinishedGames([
      ["games-state-strands/ANON", saved({ history: HISTORY.slice(0, 7), isSolved: true })],
      ["games-state-strands/42", saved({ history: HISTORY, isSolved: true })],
    ]);
    expect(games.map((g) => [g.account, g.grid])).toEqual([["42", "hbbbshbbb"]]);
    expect(core.findFinishedGames([["games-state-strands/ANON", saved({ history: HISTORY, isSolved: false })]])).toEqual([]);
    expect(
      core.findFinishedGames([
        ["games-state-strands/ANON", saved({ history: HISTORY, isSolved: true, isPlayingArchive: true })],
      ]),
    ).toEqual([]);
    expect(core.findFinishedGames([["games-state-strands/ANON", saved({ history: [h("OOPS")], isSolved: true })]])).toEqual(
      [],
    );
    expect(core.findFinishedGames([["games-state-strands/ANON", "{oops"]])).toEqual([]);
  });

  it("numbers puzzles the same way the app does", () => {
    expect(core.numberFromPrintDate("2026-11-23")).toBe(strandsNumberFor(new Date(2026, 10, 23)));
  });
});

it("builds a result whose share text the app can parse", () => {
  const [game] = core.findFinishedGames([["games-state-strands/ANON", saved({ history: HISTORY, isSolved: true })]]);
  const result = core.toResult(game);
  expect(result).toEqual({ puzzle: "995", hints: 2, words: 7, spangram: 4, grid: "hbbbshbbb" });
  expect(parseStrands(core.shareText(result))).toEqual({ ok: true, result });
  expect(core.formatScore(result)).toBe("2💡");
});
