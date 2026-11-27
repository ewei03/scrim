import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Perceptle (perceptle.com): five quick tests of perception, each scored out
 * of 100. The day's score is their average, rounded; highest wins.
 */
export type PerceptleResult = {
  puzzle: string;
  /** 0–100: the five scores' average, rounded. */
  total: number;
  /** 0–100 each, in the game's order (see EVENTS). Absent for a manual entry. */
  events?: number[];
};

/** The five tests, in the order Perceptle plays and shares them. */
export const EVENTS = [
  { id: "count", emoji: "🔢", name: "Count" },
  { id: "predict", emoji: "🎯", name: "Track" },
  { id: "level", emoji: "📐", name: "Angle" },
  { id: "tempo", emoji: "🥁", name: "Tempo" },
  { id: "split", emoji: "✂️", name: "Split" },
] as const;

/** Perceptle #1 was 2026-07-18, by the player's local date. */
const EPOCH_UTC = Date.UTC(2026, 6, 17);
const DAY_MS = 86_400_000;

export function perceptleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

/** Perceptle's letter for a score: S 95+, A 85+, B 70+, C 55+, D 40+, else F. */
export function grade(score: number): string {
  return score >= 95 ? "S" : score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
}

export function totalOf(events: number[]): number {
  return Math.round(events.reduce((sum, n) => sum + n, 0) / events.length);
}

// "Perceptle #132 - B (78)", or "Perceptle #133 🃏 - A (88)" on its harder Fridays.
const HEADER = /Perceptle\s+#\s*(\d[\d,]*)\s*(?:🃏)?\s*[-–—]\s*([SABCDF])\s*\(\s*(\d{1,3})\s*\)/iu;
// "🔢 80  🎯 70  📐 90  🥁 60  ✂️ 90"
const EVENT_SCORE = (emoji: string) => new RegExp(`${emoji.replace(/️/g, "")}\\uFE0F?\\s*(\\d{1,3})`, "u");

export function checkPerceptle(events: number[]): string | null {
  if (events.length !== EVENTS.length) return `Perceptle has ${EVENTS.length} scores.`;
  if (events.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return "Each score must be between 0 and 100.";
  return null;
}

export function parsePerceptle(text: string): ParseResult<PerceptleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Perceptle score." };
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const rest = clean.slice((header.index ?? 0) + header[0].length);

  const events: number[] = [];
  for (const e of EVENTS) {
    const m = rest.match(EVENT_SCORE(e.emoji));
    if (!m) return { ok: false, error: "Couldn't find all five scores. Paste the whole share text." };
    events.push(Number(m[1]));
  }
  const problem = checkPerceptle(events);
  if (problem) return { ok: false, error: problem };
  const total = totalOf(events);
  if (total !== Number(header[3])) return { ok: false, error: "The five scores don't add up to that total." };
  return { ok: true, result: { puzzle, total, events } };
}

export function manualPerceptle(puzzle: string, total: number): PerceptleResult {
  return { puzzle, total };
}

export const perceptle: GameAdapter<PerceptleResult> = {
  id: "perceptle",
  name: "Perceptle",
  url: "https://perceptle.com/",
  source: "perceptle.com",
  color: "#5fd3ea",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish all five tests, click Share, then paste it here.",
  parseShareText: parsePerceptle,

  compare: (a, b) => b.total - a.total,
  canWin: () => true,
  formatScore: (r) => `${r.total} ${grade(r.total)}`,
  averageLabel: "Avg score",
  averageHigherIsBetter: true,
  average(results) {
    if (results.length === 0) return null;
    return (results.reduce((sum, r) => sum + r.total, 0) / results.length).toFixed(1);
  },
};
