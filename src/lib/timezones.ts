/**
 * Time zones as people read them: grouped by region, each with its city, its
 * short name (EST, CET, or UTC+8 where there's no common one) and the time
 * there right now.
 */

export type ZoneOption = {
  id: string;
  /** "New York", "Argentina – Buenos Aires" */
  city: string;
  /** "EST", "UTC+8" */
  abbr: string;
  /** "3:42 PM" */
  time: string;
  label: string;
};

export type ZoneGroup = { region: string; zones: ZoneOption[] };

const formatters = new Map<string, { abbr: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();

function formattersFor(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = {
      abbr: new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }),
      time: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }),
    };
    formatters.set(zone, f);
  }
  return f;
}

/** One zone, described. */
export function describeZone(id: string, now = new Date()): ZoneOption {
  const slash = id.indexOf("/");
  const city = (slash === -1 ? id : id.slice(slash + 1)).replaceAll("/", " – ").replaceAll("_", " ");
  let abbr = "";
  let time = "";
  try {
    const f = formattersFor(id);
    abbr = f.abbr.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT+8" reads better as "UTC+8"; plain "GMT" (London in winter) is a real name, so it stays.
    abbr = abbr.replace(/^GMT(?=[+-])/, "UTC");
    time = f.time.format(now);
  } catch {
    // A zone this browser doesn't know: just its name.
  }
  const label = [city, abbr, time].filter(Boolean).join(" · ");
  return { id, city, abbr, time, label };
}

/** Every zone this browser knows (plus `current` and UTC), grouped by region; UTC first. */
export function zoneGroups(current: string, now = new Date()): ZoneGroup[] {
  let ids: string[] = [];
  try {
    ids = Intl.supportedValuesOf("timeZone");
  } catch {
    // Older browsers: just the current one and UTC.
  }
  const groups = new Map<string, ZoneOption[]>();
  for (const id of new Set([current, "UTC", ...ids])) {
    const slash = id.indexOf("/");
    const region = slash === -1 ? "Other" : id.slice(0, slash);
    if (id === "UTC") continue;
    const list = groups.get(region) ?? [];
    list.push(describeZone(id, now));
    groups.set(region, list);
  }
  const sorted = [...groups.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([region, zones]) => ({ region, zones: zones.sort((a, b) => a.city.localeCompare(b.city)) }));
  const utc = describeZone("UTC", now);
  return [{ region: "UTC", zones: [{ ...utc, label: `UTC · ${utc.time}`.replace(/ · $/, "") }] }, ...sorted];
}
