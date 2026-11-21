import { describe, expect, it } from "vitest";
import { joinedSince, listNames } from "./crewVisits";

const at = (iso: string) => new Date(iso).getTime();
const members = [
  { user_id: "me", joined_at: "2026-11-20T09:00:00Z" },
  { user_id: "old", joined_at: "2026-11-01T09:00:00Z" },
  { user_id: "late", joined_at: "2026-11-21T12:00:00Z" },
  { user_id: "early", joined_at: "2026-11-21T08:00:00Z" },
];

describe("joinedSince", () => {
  it("lists others who joined after your last visit, oldest first", () => {
    expect(joinedSince(members, "me", at("2026-11-15T00:00:00Z")).map((m) => m.user_id)).toEqual(["early", "late"]);
  });

  it("never lists you, and lists nobody on a first visit", () => {
    expect(joinedSince(members, "me", at("2026-01-01T00:00:00Z")).map((m) => m.user_id)).not.toContain("me");
    expect(joinedSince(members, "me", null)).toEqual([]);
  });
});

describe("listNames", () => {
  it("reads like a sentence", () => {
    expect(listNames(["Sam"])).toBe("Sam");
    expect(listNames(["Sam", "Alex"])).toBe("Sam and Alex");
    expect(listNames(["Sam", "Alex", "Jo"])).toBe("Sam, Alex and Jo");
    expect(listNames(["Sam", "Alex", "Jo", "Kim", "Lee"])).toBe("Sam, Alex and 3 others");
  });
});
