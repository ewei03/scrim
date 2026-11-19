export type DeadlinePreset = "midnight" | "24h" | "48h";

export const DEADLINE_PRESETS: { id: DeadlinePreset; label: string }[] = [
  { id: "midnight", label: "Tonight at midnight" },
  { id: "24h", label: "In 24 hours" },
  { id: "48h", label: "In 48 hours" },
];

export function deadlineFrom(preset: DeadlinePreset, now = new Date()): Date {
  if (preset === "24h") return new Date(now.getTime() + 24 * 3_600_000);
  if (preset === "48h") return new Date(now.getTime() + 48 * 3_600_000);
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
