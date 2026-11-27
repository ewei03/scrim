import { describe, expect, it } from "vitest";
import { parsePerceptle, perceptle, perceptleNumberFor } from "@/games/perceptle";
import core from "./perceptle-core.js";

// Save shape from perceptle.com's code, checked 2026-11-26.
describe("Perceptle", () => {
  const TODAY = "2026-11-26";
  const IDS = ["count", "predict", "level", "tempo", "split"];
  const save = (scores: number[], date = TODAY, extra: object = {}): [string, string][] => [
    ["perceptle:2026-11-25", JSON.stringify({ v: 1, date: "2026-11-25", puzzle: 131, total: 50, grade: "D", events: [] })],
    [
      `perceptle:${date}`,
      JSON.stringify({
        v: 1,
        date,
        puzzle: core.numberFromDate(date),
        total: 0,
        grade: "F",
        events: scores.map((score, i) => ({ id: IDS[i], score, grade: "F", human: "" })),
        ...extra,
      }),
    ],
  ];

  it("numbers days the same way the app does", () => {
    expect(core.numberFromDate(TODAY)).toBe(132);
    expect(core.numberFromDate(TODAY)).toBe(perceptleNumberFor(new Date(2026, 10, 26)));
  });

  it("finds today's finished game", () => {
    expect(core.findFinishedGames(save([80, 70, 90, 60, 91]), TODAY)).toEqual([
      { puzzle: "132", events: [80, 70, 90, 60, 91] },
    ]);
  });

  it("ignores other days, old saves and broken ones", () => {
    expect(core.findFinishedGames(save([80, 70, 90, 60, 91], "2026-11-20"), TODAY)).toEqual([]);
    expect(core.findFinishedGames(save([80, 70, 90, 60]), TODAY)).toEqual([]);
    expect(core.findFinishedGames(save([80, 70, 90, 60, 101]), TODAY)).toEqual([]);
    expect(core.findFinishedGames(save([80, 70, 90, 60, 91], TODAY, { v: 2 }), TODAY)).toEqual([]);
    expect(core.findFinishedGames([["perceptle:2026-11-26", "{"]], TODAY)).toEqual([]);
    expect(core.findFinishedGames([], TODAY)).toEqual([]);
  });

  it("writes a share the site's parser reads back", () => {
    const [g] = core.findFinishedGames(save([80, 70, 90, 60, 91]), TODAY);
    const result = core.toResult(g);
    expect(result).toEqual({ puzzle: "132", total: 78, events: [80, 70, 90, 60, 91] });
    expect(parsePerceptle(core.shareText(result))).toEqual({ ok: true, result });
    expect(core.formatScore(result)).toBe(perceptle.formatScore(result));
  });
});
