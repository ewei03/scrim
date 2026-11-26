import { describe, expect, it } from "vitest";
import { groupItems, groupName, mainId, modeLabel } from "./modes";
import { GAMES } from "./registry";

describe("mode groups", () => {
  it("only name real games", () => {
    for (const id of ["costcodle", "costcodleclassic", "minicrossword", "minicrosswordhard"]) expect(GAMES[id]).toBeDefined();
  });

  it("stand for a group by its main mode", () => {
    expect(mainId("costcodleclassic")).toBe("costcodle");
    expect(mainId("minicrosswordhard")).toBe("minicrossword");
    expect(mainId("wordle")).toBe("wordle");
    expect(modeLabel("costcodleclassic")).toBe("Classic");
    expect(modeLabel("wordle")).toBeNull();
    expect(groupName("minicrosswordhard", "Mini Crossword (Hard)")).toBe("Mini Crossword");
    expect(groupName("wordle", "Wordle")).toBe("Wordle");
  });

  it("put a game's modes together, where the first of them comes, in the group's order", () => {
    const ids = ["costcodleclassic", "wordle", "costcodle", "minicrosswordhard"];
    expect(groupItems(ids, (id) => id)).toEqual([
      { id: "costcodle", items: ["costcodle", "costcodleclassic"] },
      { id: "wordle", items: ["wordle"] },
      { id: "minicrossword", items: ["minicrosswordhard"] },
    ]);
  });
});
