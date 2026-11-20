import { describe, expect, it } from "vitest";
import { krillionNumberFor, parseKrillion } from "@/games/krillion";
import core from "./krillion-core.js";

// Shapes from krillion.io's own code (stats history entry and in-progress game).
const TIERS = ["schooler", "plankton", "rare", "miss", "krillion", "schooler", "deepcut"];
const stats = (history: Record<string, unknown>) => JSON.stringify({ history });
const entry = (tiers = TIERS) => ({ score: 0, tiers, prompts: Array(7).fill("?"), results: [] });

describe("findFinishedDives", () => {
  it("reads daily history, signed out or signed in, newest first", () => {
    const dives = core.findFinishedDives(
      [
        ["krillion:stats:v1", stats({ "2026-11-18": entry(), "2026-11-17": entry() })],
        ["krillion:account:abc%40x:krillion:stats:v1", stats({ "2026-11-19": entry() })],
      ],
      2,
    );
    expect(dives).toEqual([
      { puzzle: "127", date: "2026-11-19", tiers: "sprxksd" },
      { puzzle: "126", date: "2026-11-18", tiers: "sprxksd" },
    ]);
  });

  it("also reads a just-finished game, and ignores unfinished ones and other modes", () => {
    const game = (phase: string) =>
      JSON.stringify({ date: "2026-11-19", phase, results: TIERS.map((t) => ({ tier: t === "miss" ? null : t })) });
    expect(core.findFinishedDives([["krillion:game:v1", game("done")]])).toEqual([
      { puzzle: "127", date: "2026-11-19", tiers: "sprxksd" },
    ]);
    expect(
      core.findFinishedDives([
        ["krillion:game:v1", game("playing")],
        ["krillion-unlimited-5", stats({ "2026-11-19": entry() })],
        ["krillion:stats:v1", stats({ "2026-11-19": entry(TIERS.slice(1)) })],
      ]),
    ).toEqual([]);
  });

  it("numbers dives the same way the app does", () => {
    expect(core.numberFromDate("2026-11-19")).toBe(krillionNumberFor(new Date("2026-11-19T12:00:00Z")));
  });
});

it("builds a result whose share text the app can parse", () => {
  const result = core.toResult({ puzzle: "127", date: "2026-11-19", tiers: "sprxksd" });
  expect(result).toEqual({ puzzle: "127", points: 315, tiers: "sprxksd" });
  expect(parseKrillion(core.shareText(result))).toEqual({ ok: true, result });
});
