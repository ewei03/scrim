import { describe, expect, it } from "vitest";
import { describeZone, zoneGroups } from "./timezones";

// 2026-01-15 20:42 UTC: winter in the north.
const WINTER = new Date(Date.UTC(2026, 0, 15, 20, 42));
const SUMMER = new Date(Date.UTC(2026, 6, 15, 20, 42));

describe("describeZone", () => {
  it("names the city, the zone's short name and the time there", () => {
    expect(describeZone("America/New_York", WINTER)).toMatchObject({
      city: "New York",
      abbr: "EST",
      time: "3:42 PM",
      label: "New York · EST · 3:42 PM",
    });
    expect(describeZone("America/New_York", SUMMER).abbr).toBe("EDT");
  });

  it("uses UTC offsets where there's no common name, and keeps GMT where there is", () => {
    expect(describeZone("Asia/Singapore", WINTER)).toMatchObject({ abbr: "UTC+8", time: "4:42 AM" });
    expect(describeZone("Europe/London", WINTER).abbr).toBe("GMT");
  });

  it("reads nested names and underscores", () => {
    expect(describeZone("America/Argentina/Buenos_Aires", WINTER).city).toBe("Argentina – Buenos Aires");
  });
});

describe("zoneGroups", () => {
  it("puts UTC first, then regions in order, with the current zone included", () => {
    const groups = zoneGroups("America/New_York", WINTER);
    expect(groups[0]).toEqual({ region: "UTC", zones: [expect.objectContaining({ id: "UTC", label: "UTC · 8:42 PM" })] });
    const regions = groups.map((g) => g.region);
    expect(regions.indexOf("America")).toBeLessThan(regions.indexOf("Europe"));
    const america = groups.find((g) => g.region === "America")!.zones.map((z) => z.city);
    expect(america).toContain("New York");
    expect(america).toEqual([...america].sort((a, b) => a.localeCompare(b)));
  });
});
