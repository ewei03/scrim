import { describe, expect, it } from "vitest";
import { cleanName, typedName } from "./names";

describe("names", () => {
  it("keeps letters, digits and single spaces while typing", () => {
    expect(typedName("Sam's  Crew!")).toBe("Sams Crew");
    expect(typedName(" José 2")).toBe("Jos 2");
    expect(typedName("ok ")).toBe("ok ");
  });

  it("cleans a name for saving", () => {
    expect(cleanName("  O'Brien  Team ", 24)).toBe("OBrien Team");
    expect(cleanName("abcdefgh ijkl", 9)).toBe("abcdefgh");
    expect(cleanName("!!!", 16)).toBe("");
  });
});
