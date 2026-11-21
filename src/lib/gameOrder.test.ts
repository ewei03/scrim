import { describe, expect, it } from "vitest";
import { inSavedOrder } from "./gameOrder";

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
