import type { GameAdapter } from "./types";

/**
 * Custom games: daily games Scrim doesn't integrate, set up by a crew's owner
 * (see 0011_custom_games.sql). Scores are typed in by hand. Everything about
 * how a score is entered, shown and ranked comes from the game's settings.
 */

export type ScoreType = "points" | "time" | "attempts";
export type TimeFormat = "m:ss" | "h:mm:ss" | "m:ss.s";

/** A row of `custom_games`. */
export type CustomGame = {
  id: string;
  crew_id: string;
  name: string;
  url: string | null;
  instructions: string | null;
  color: string;
  score_type: ScoreType;
  higher_is_better: boolean;
  decimals: number;
  unit: string | null;
  time_format: TimeFormat | null;
  max_attempts: number | null;
  allow_fail: boolean;
  created_at: string;
};

/** The settings the owner fills in (what create/update_custom_game take). */
export type CustomSettings = Pick<
  CustomGame,
  | "name"
  | "url"
  | "instructions"
  | "color"
  | "score_type"
  | "higher_is_better"
  | "decimals"
  | "unit"
  | "time_format"
  | "max_attempts"
  | "allow_fail"
>;

/** A score: a value, or "didn't finish" when the game allows it. */
export type CustomResult = { puzzle: string; failed?: boolean; value?: number };

/** Colours to choose from: mid-light, so dark text reads on them. */
export const CUSTOM_COLORS = ["#f2a65a", "#e8857f", "#d98cc4", "#9d8cf0", "#5aa9e6", "#4fc1a6", "#a3c45a", "#d4b13f"];

/** Days are numbered from 2020-01-01, by the crew's date. */
const EPOCH_UTC = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;

export const customGameId = (id: string) => `custom:${id}`;
export const isCustomGameId = (id: string) => id.startsWith("custom:");

export const SCORE_TYPES: { id: ScoreType; label: string; higherIsBetter: boolean }[] = [
  { id: "points", label: "Points", higherIsBetter: true },
  { id: "time", label: "Time", higherIsBetter: false },
  { id: "attempts", label: "Attempts", higherIsBetter: false },
];

/** "4:05", "1:04:05" or "4:05.3". */
export function formatTime(seconds: number, format: TimeFormat | null): string {
  const tenths = format === "m:ss.s";
  const total = tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  const whole = Math.floor(total);
  const s = whole % 60;
  const frac = tenths ? `.${Math.round((total - whole) * 10) % 10}` : "";
  if (format === "h:mm:ss") {
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${Math.floor(whole / 60)}:${String(s).padStart(2, "0")}${frac}`;
}

/** Reads "4:05", "1:04:05", "245" (seconds) or "4:05.3" into seconds; null if it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const [main, frac] = t.split(".");
  const parts = main.split(":").map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  const seconds = parts.reduce((total, p) => total * 60 + p, 0);
  return seconds + (frac ? Number(`0.${frac}`) : 0);
}

export function formatCustomValue(g: CustomSettings, value: number): string {
  if (g.score_type === "time") return formatTime(value, g.time_format);
  if (g.score_type === "attempts") return g.max_attempts ? `${value}/${g.max_attempts}` : `${value} ${value === 1 ? "try" : "tries"}`;
  const number = value.toLocaleString("en-US", { minimumFractionDigits: g.decimals, maximumFractionDigits: g.decimals });
  return g.unit ? `${number} ${g.unit}` : number;
}

export function formatCustomScore(g: CustomSettings, r: CustomResult): string {
  if (r.failed || r.value === undefined) {
    return g.score_type === "attempts" && g.max_attempts ? `X/${g.max_attempts}` : "DNF";
  }
  return formatCustomValue(g, r.value);
}

/** The label people see for "didn't finish", per score type. */
export function failLabel(g: Pick<CustomSettings, "score_type">): string {
  return g.score_type === "attempts" ? "Didn't get it" : "Didn't finish";
}

export function customAdapter(g: CustomGame): GameAdapter<CustomResult> & { custom: CustomGame } {
  const rank = (r: CustomResult) =>
    r.failed || r.value === undefined ? Infinity : g.higher_is_better ? -r.value : r.value;

  return {
    id: customGameId(g.id),
    name: g.name,
    url: g.url ?? "",
    color: g.color,
    source: "Custom game",
    free: true,
    custom: g,

    puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
    puzzleLabel: (id) =>
      new Date(EPOCH_UTC + Number(id) * DAY_MS).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),

    autoSubmit: false,
    shareHint: "",
    sharePlaceholder: "",
    parseShareText: () => ({ ok: false, error: "Scores for custom games are entered by hand." }),

    compare: (a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra === rb ? 0 : ra < rb ? -1 : 1;
    },
    canWin: (r) => !r.failed && r.value !== undefined,
    formatScore: (r) => formatCustomScore(g, r),
    averageLabel: g.score_type === "time" ? "Avg time" : g.score_type === "attempts" ? "Avg tries" : "Avg score",
    average(results) {
      const values = results.filter((r) => !r.failed && r.value !== undefined).map((r) => r.value as number);
      if (values.length === 0) return null;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (g.score_type === "time") return formatTime(avg, g.time_format);
      if (g.score_type === "attempts") return avg.toFixed(2);
      return avg.toLocaleString("en-US", { maximumFractionDigits: Math.min(g.decimals + 1, 3) });
    },
  };
}

/** Narrows a game to a custom one, for the UI bits that differ. */
export function customOf(game: GameAdapter<unknown>): CustomGame | null {
  return (game as { custom?: CustomGame }).custom ?? null;
}
