import { describe, expect, it } from "vitest";
import { rankEntries } from "./ranking";
import { connections, connectionsNumberFor, manualConnections, parseConnections } from "./connections";

describe("connectionsNumberFor", () => {
  it("matches known puzzle numbers", () => {
    expect(connectionsNumberFor(new Date(2023, 5, 12))).toBe(1);
    expect(connectionsNumberFor(new Date(2024, 6, 18, 23, 59))).toBe(403);
  });
});

describe("parseConnections", () => {
  it("reads a solve with mistakes", () => {
    const r = parseConnections("Connections\nPuzzle #403\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪");
    expect(r).toEqual({
      ok: true,
      result: { puzzle: "403", solved: true, mistakes: 1, groups: 4, grid: ["yyyy", "gbgg", "gggg", "bbbb", "pppp"] },
    });
    expect(connections.formatScore(r.ok ? r.result : ({} as never))).toBe("1 mistake");
  });

  it("reads a loss and big puzzle numbers", () => {
    const r = parseConnections(
      "Connections \r\nPuzzle #1,257\r\n🟨🟨🟨🟨\r\n🟩🟦🟩🟩\r\n🟪🟦🟩🟩\r\n🟦🟦🟪🟦\r\n🟪🟩🟦🟪",
    );
    expect(r.ok && r.result).toMatchObject({ puzzle: "1257", solved: false, mistakes: 4, groups: 1 });
  });

  it("rejects text that isn't a finished game", () => {
    expect(parseConnections("Wordle 1,612 3/6").ok).toBe(false);
    expect(parseConnections("Connections\nPuzzle #1").ok).toBe(false);
    // Stopped before finishing.
    expect(parseConnections("Connections\nPuzzle #1\n🟨🟨🟨🟨\n🟩🟦🟩🟩").ok).toBe(false);
    // A row of five, a stray row after the grid, and a found colour coming back.
    expect(parseConnections("Connections\nPuzzle #1\n🟨🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪").ok).toBe(false);
    expect(parseConnections("Connections\nPuzzle #1\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪\n\n🟪🟪🟪🟪").ok).toBe(false);
    expect(parseConnections("Connections\nPuzzle #1\n🟨🟨🟨🟨\n🟨🟩🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪")).toMatchObject({
      ok: false,
      error: /shows up again/,
    });
    // Same group twice.
    expect(parseConnections("Connections\nPuzzle #1\n🟨🟨🟨🟨\n🟨🟨🟨🟨\n🟦🟦🟦🟦\n🟪🟪🟪🟪").ok).toBe(false);
  });
});

it("ranks solves by mistakes, then losses by groups found", () => {
  const e = (id: string, mistakes: number | null, groups = 0) => ({ id, result: manualConnections("1", mistakes, groups) });
  const ranked = rankEntries(connections, [e("lost2", null, 2), e("one", 1), e("perfect", 0), e("lost0", null)]);
  expect(ranked.map((r) => [r.id, r.place, r.winner])).toEqual([
    ["perfect", 1, true],
    ["one", 2, false],
    ["lost2", 3, false],
    ["lost0", 4, false],
  ]);
});
