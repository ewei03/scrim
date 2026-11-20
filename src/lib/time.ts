/** The next local midnight, when daily puzzles like Wordle roll over. */
export function nextMidnight(now = new Date()): Date {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight;
}

/** Calendar date [year, month (1-12), day] in a time zone. */
export function dateIn(timeZone: string, now = new Date()): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(now)
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return [parts.year, parts.month, parts.day];
}

/** Milliseconds that `timeZone` is ahead of UTC at instant `t`. */
function offsetIn(timeZone: string, t: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  })
    .formatToParts(new Date(t))
    .reduce<Record<string, number>>((acc, x) => (x.type === "literal" ? acc : { ...acc, [x.type]: Number(x.value) }), {});
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The next midnight in `timeZone`, for games that reset at one moment worldwide. */
export function nextMidnightIn(timeZone: string, now = new Date()): Date {
  const [y, m, d] = dateIn(timeZone, now);
  const wall = Date.UTC(y, m - 1, d + 1);
  // Correct for the zone's offset; check again in case DST changes in between.
  let t = wall - offsetIn(timeZone, wall);
  t = wall - offsetIn(timeZone, t);
  return new Date(t);
}

/** "4h 12m", "12m", "<1m" */
export function timeLeft(iso: string, now = Date.now()): string {
  const mins = Math.floor((new Date(iso).getTime() - now) / 60_000);
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function ordinal(n: number): string {
  const suffixes = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
