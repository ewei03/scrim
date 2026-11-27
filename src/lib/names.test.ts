import { describe, expect, it } from "vitest";
import { cleanName, typedName } from "./names";

describe("names", () => {
  it("keeps any characters but collapses spaces while typing", () => {
    expect(typedName("Sam's  Crew!")).toBe("Sam's Crew!");
    expect(typedName(" José 2")).toBe("José 2");
    expect(typedName("ok ")).toBe("ok ");
  });

  it("drops emoji", () => {
    expect(typedName("Sam 😀 Crew")).toBe("Sam Crew");
    expect(typedName("Fire🔥🔥")).toBe("Fire");
    expect(typedName("Team ❤️")).toBe("Team ");
    expect(typedName("👨‍👩‍👧 Fam")).toBe("Fam");
    expect(typedName("Hi 👍🏽")).toBe("Hi ");
    expect(typedName("🇯🇵 Japan")).toBe("Japan");
    expect(typedName("1️⃣ Up")).toBe("1 Up");
  });

  it("cleans a name for saving", () => {
    expect(cleanName("  O'Brien  Team ", 24)).toBe("O'Brien Team");
    expect(cleanName("abcdefgh ijkl", 9)).toBe("abcdefgh");
    expect(cleanName("!!!", 16)).toBe("!!!");
    expect(cleanName("😀😀", 16)).toBe("");
    expect(cleanName("   ", 16)).toBe("");
  });

  it("counts characters outside the BMP as one", () => {
    expect(cleanName("𝐀𝐁𝐂", 2)).toBe("𝐀𝐁");
  });
});
