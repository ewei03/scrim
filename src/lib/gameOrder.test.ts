import { describe, expect, it } from "vitest";
import { inSavedOrder, unplayedFirst } from "./gameOrder";

describe("inSavedOrder", () => {
  const ids = (order: string[], items = ["a", "b", "c", "d"]) => inSavedOrder(items, (x) => x, order);

  it("keeps the usual order with nothing saved", () => {
    expect(ids([])).toEqual(["a", "b", "c", "d"]);
  });

  it("follows the saved order", () => {
    expect(ids(["d", "b", "a", "c"])).toEqual(["d", "b", "a", "c"]);
  });

  it("puts games added since last, in their usual order, and skips ones no longer played", () => {
    expect(ids(["gone", "c", "a"])).toEqual(["c", "a", "b", "d"]);
  });
});

describe("unplayedFirst", () => {
  it("moves games still to play up, keeping each group in order", () => {
    const toPlay = new Set(["c", "a"]);
    expect(unplayedFirst(["a", "b", "c", "d"], (id) => toPlay.has(id))).toEqual(["a", "c", "b", "d"]);
  });
});
