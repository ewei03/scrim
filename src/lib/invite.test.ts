import { describe, expect, it } from "vitest";
import { inviteCode } from "./invite";

describe("inviteCode", () => {
  it("takes the code from a full link, a path, or on its own", () => {
    expect(inviteCode("https://scrim.example/crew/AbC12345")).toBe("abc12345");
    expect(inviteCode("  http://localhost:3000/crew/abc12345/?ref=x#top ")).toBe("abc12345");
    expect(inviteCode("/crew/abc12345")).toBe("abc12345");
    expect(inviteCode("abc12345")).toBe("abc12345");
  });

  it("rejects anything else", () => {
    expect(inviteCode("")).toBeNull();
    expect(inviteCode("https://scrim.example/profile")).toBeNull();
    expect(inviteCode("not a code")).toBeNull();
    expect(inviteCode("https://scrim.example/crew/abc/extra")).toBeNull();
  });
});
