/** The next local midnight, when daily puzzles like Wordle roll over. */
export function nextMidnight(now = new Date()): Date {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight;
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
