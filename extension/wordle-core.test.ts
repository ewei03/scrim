import { describe, expect, it } from "vitest";
import { parseWordle } from "@/games/wordle";
import core from "./wordle-core.js";

// Captured from nytimes.com/games/wordle on 2026-11-19.
const WIN = `{"states":[{"puzzleId":"1555","data":{"boardState":["clout","","","","",""],"currentRowIndex":1,"status":"WIN","hardMode":false,"isPlayingArchive":false},"schemaVersion":"0.52.0","timestamp":1795123872,"printDate":"2026-11-19"}]}`;
const FAIL = `{"states":[{"puzzleId":"1555","data":{"boardState":["audio","pious","tempo","dumpy","fight","brick"],"currentRowIndex":6,"status":"FAIL","hardMode":false,"isPlayingArchive":false},"schemaVersion":"0.52.0","timestamp":1795124019,"printDate":"2026-11-19"}]}`;

const state = (status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    states: [
      {
        puzzleId: "1555",
        printDate: "2026-11-19",
        data: { boardState: ["crane", "cloth", "clout", "", "", ""], status, hardMode: true, isPlayingArchive: false, ...extra },
      },
    ],
  });

describe("numberFromPrintDate", () => {
  it("matches NYT's days_since_launch", () => {
    expect(core.numberFromPrintDate("2026-11-19")).toBe(1979);
    expect(core.numberFromPrintDate("2024-03-15")).toBe(1000);
  });
});

describe("findFinishedGames", () => {
  it("reads real NYT win and loss states", () => {
    expect(core.findFinishedGames([["games-state-wordleV2/ANON", WIN]])).toEqual([
      {
        signedIn: false,
        account: null,
        puzzle: "1979",
        printDate: "2026-11-19",
        solved: true,
        guesses: ["clout"],
        hardMode: false,
      },
    ]);
    const [loss] = core.findFinishedGames([["games-state-wordleV2/12345", FAIL]]);
    expect(loss).toMatchObject({
      signedIn: true,
      account: "12345",
      solved: false,
      guesses: ["audio", "pious", "tempo", "dumpy", "fight", "brick"],
    });
  });

  it("tells signed-in saves from signed-out ones", () => {
    expect(core.isSignedInKey("games-state-wordleV2/98765432")).toBe(true);
    expect(core.isSignedInKey("games-state-wordleV2/ANON")).toBe(false);
    expect(core.isSignedInKey("games-state-wordleV2")).toBe(false);
  });

  it("ignores in-progress games, archive plays, junk and other keys", () => {
    expect(
      core.findFinishedGames([
        ["games-state-wordleV2/ANON", state("IN_PROGRESS")],
        ["games-state-wordleV2/1", state("WIN", { isPlayingArchive: true })],
        ["games-state-wordleV2/2", "{not json"],
        ["nyt-wordle-darkmode", "false"],
      ]),
    ).toEqual([]);
  });
});

describe("findBoardGame", () => {
  const TODAY = "2026-11-19";
  const tiles = (word: string, states: string) =>
    Array.from(word, (letter, i) => ({ state: ({ g: "correct", y: "present", ".": "absent" } as const)[states[i] as "g"], letter }));
  const empty = () => Array.from({ length: 5 }, () => ({ state: "empty", letter: "" }));
  // A save NYT made here before the game was finished on another device.
  const inProgress: [string, string][] = [["games-state-wordleV2/216849005", state("IN_PROGRESS", { boardState: [], hardMode: false })]];

  it("reads a win from the board when the save says in progress", () => {
    const rows = [tiles("CRANE", "...y."), tiles("CLOUT", "ggggg"), empty(), empty(), empty(), empty()];
    expect(core.findBoardGame(inProgress, rows, TODAY)).toEqual({
      signedIn: true,
      account: "216849005",
      hardMode: false,
      puzzle: "1979",
      printDate: TODAY,
      solved: true,
      guesses: ["crane", "clout"],
    });
  });

  it("reads a loss once all six rows are scored", () => {
    const rows = ["audio", "pious", "tempo", "dumpy", "fight", "brick"].map((w) => tiles(w, "y...."));
    expect(core.findBoardGame(inProgress, rows, TODAY)).toMatchObject({ solved: false, guesses: expect.any(Array) });
  });

  it("ignores an unfinished board, or one still flipping", () => {
    expect(core.findBoardGame(inProgress, [tiles("crane", "...y."), empty()], TODAY)).toBeNull();
    const flipping = [tiles("clout", "gggg."), empty()];
    flipping[0][4] = { state: "tbd", letter: "T" };
    expect(core.findBoardGame(inProgress, flipping, TODAY)).toBeNull();
  });

  it("leaves it to the save when the save is finished", () => {
    expect(core.findBoardGame([["games-state-wordleV2/1", WIN]], [tiles("clout", "ggggg")], TODAY)).toBeNull();
  });

  it("with no save for today, counts it for the one signed-in account", () => {
    // Signed in, NYT can keep today's game on its server only: the newest save here is older.
    const win = [tiles("clout", "ggggg")];
    expect(core.findBoardGame(inProgress, win, "2026-11-20")).toMatchObject({
      signedIn: true,
      account: "216849005",
      puzzle: "1980",
      solved: true,
    });
    const settings: [string, string][] = [["games-settings-wordleV2/42", '{"states":[{"data":{"hardMode":true}}]}']];
    expect(core.findBoardGame(settings, win, TODAY)).toMatchObject({ account: "42", hardMode: true });
  });

  it("won't guess whose it is: signed out, or more than one account", () => {
    const win = [tiles("clout", "ggggg")];
    expect(core.findBoardGame([], win, TODAY)).toBeNull();
    expect(core.findBoardGame([["games-state-wordleV2/ANON", state("WIN")]], win, "2026-11-20")).toBeNull();
    const two: [string, string][] = [...inProgress, ["games-settings-wordleV2/7", "{}"]];
    expect(core.findBoardGame(two, win, "2026-11-20")).toBeNull();
  });

  it("ignores an archive puzzle on the board", () => {
    const win = [tiles("clout", "ggggg")];
    const archive: [string, string][] = [["games-state-wordleV2/1", state("IN_PROGRESS", { isPlayingArchive: true })]];
    expect(core.findBoardGame(archive, win, TODAY)).toBeNull();
  });
});

describe("evaluate", () => {
  it("colours repeated letters like Wordle does", () => {
    expect(core.evaluate("crane", "clout")).toBe("g....");
    expect(core.evaluate("speed", "abide")).toBe("..y.y");
    expect(core.evaluate("eerie", "abide")).toBe("...yg");
    expect(core.evaluate("lolly", "hello")).toBe(".ygg.");
  });
});

describe("toResult", () => {
  const [game] = core.findFinishedGames([["games-state-wordleV2/ANON", state("WIN")]]);

  it("prefers the grid shown on the page", () => {
    const tiles = [
      ["absent", "absent", "absent", "absent", "present"],
      ["correct", "absent", "absent", "absent", "absent"],
      ["correct", "correct", "correct", "correct", "correct"],
      ["empty", "empty", "empty", "empty", "empty"],
    ];
    expect(core.toResult(game, tiles)).toEqual({
      puzzle: "1979",
      solved: true,
      guesses: 3,
      hard: true,
      grid: ["....y", "g....", "ggggg"],
    });
  });

  it("computes the grid for a win when the page grid isn't readable", () => {
    expect(core.toResult(game, []).grid).toEqual(["g....", "gggy.", "ggggg"]);
  });

  it("omits the grid for a loss it can't read", () => {
    const [loss] = core.findFinishedGames([["games-state-wordleV2/ANON", FAIL]]);
    expect(core.toResult(loss, [])).toEqual({ puzzle: "1979", solved: false, guesses: null, hard: false });
  });

  it("produces share text that Scrim's own parser accepts", () => {
    const result = core.toResult(game, []);
    const parsed = parseWordle(core.shareText(result));
    expect(parsed).toEqual({ ok: true, result });
  });
});
