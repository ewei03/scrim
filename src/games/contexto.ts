import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

export type ContextoResult = {
  puzzle: string;
  /** False when the player gave up. */
  solved: boolean;
  /** Guesses, counting hints, as Contexto counts them. */
  guesses: number;
  hints: number;
  /**
   * How close the guesses were, from the share's bars: [green, yellow, red]
   * = closer than 300, closer than 1,500, further.
   */
  chart?: [number, number, number];
};

/**
 * Contexto (English) #0 was 2022-09-18. It resets at local midnight, like
 * Wordle. Its Portuguese and Spanish puzzles are numbered differently and
 * aren't supported.
 */
const EPOCH_UTC = Date.UTC(2022, 8, 18);
const DAY_MS = 86_400_000;
/** Most guesses Scrim takes (Contexto has no limit; this keeps scores sane). */
export const MAX_GUESSES = 9999;
const MAX_HINTS = 999;

export function contextoNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

// "I played contexto.me 11/23/2026 and got it in 24 guesses and 2 hints."
// Older shares had "#1527" in place of the date.
const HEADER =
  /I played contexto\.me\s+(?:#\s*(\d[\d,]*)|(\d{1,2})\/(\d{1,2})\/(\d{4}))\s+(and got it|but I gave up)\s+in\s+(\d[\d,]*)\s+guesses?(?:\s+and\s+(\d[\d,]*)\s+hints?)?/iu;
const UNLIMITED = /I played contexto\.me\s+unlimited/iu;
// The bars: one line each of 🟩, 🟨 and 🟥 (possibly none of them) and a count.
const CHART = /^\s*🟩*\s*(\d+)\s*$\r?\n^\s*🟨*\s*(\d+)\s*$\r?\n^\s*🟥*\s*(\d+)\s*$/mu;

const num = (s: string) => Number(s.replace(/\D/g, ""));

/** What's wrong with a result, or null if it's a possible game. */
export function checkContexto(r: Omit<ContextoResult, "puzzle">): string | null {
  if (!Number.isInteger(r.guesses) || r.guesses < 1 || r.guesses > MAX_GUESSES) {
    return `Guesses must be between 1 and ${MAX_GUESSES.toLocaleString("en-US")}.`;
  }
  if (!Number.isInteger(r.hints) || r.hints < 0 || r.hints > Math.min(MAX_HINTS, r.guesses)) {
    return "That many hints doesn't fit the guesses.";
  }
  if (r.chart) {
    const [g, y, red] = r.chart;
    if (r.chart.some((n) => !Number.isInteger(n) || n < 0) || g + y + red > r.guesses) {
      return "The bars don't match the guesses.";
    }
    if (r.solved && g < 1) return "A solved Contexto has the word itself in green.";
  }
  return null;
}

export function parseContexto(text: string): ParseResult<ContextoResult> {
  const clean = normalizeShareText(text);
  if (UNLIMITED.test(clean)) return { ok: false, error: "Unlimited games don't count: play the daily one." };
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Contexto score." };

  let puzzle: string;
  if (header[1]) {
    puzzle = String(num(header[1]));
  } else {
    const [month, day, year] = [header[2], header[3], header[4]].map(Number);
    const at = Date.UTC(year, month - 1, day);
    const date = new Date(at);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return { ok: false, error: "That date doesn't exist." };
    }
    puzzle = String(Math.round((at - EPOCH_UTC) / DAY_MS));
  }
  if (Number(puzzle) < 0) return { ok: false, error: "That's from before Contexto started." };

  const solved = /got it/i.test(header[5]);
  const guesses = num(header[6]);
  const hints = header[7] ? num(header[7]) : 0;

  const bars = clean.slice((header.index ?? 0) + header[0].length).match(CHART);
  if (!bars) return { ok: false, error: "Couldn't find the coloured bars. Paste the whole share text." };
  const chart: [number, number, number] = [Number(bars[1]), Number(bars[2]), Number(bars[3])];

  const result = { puzzle, solved, guesses, hints, chart };
  const problem = checkContexto(result);
  return problem ? { ok: false, error: problem } : { ok: true, result };
}

/** A result without its bars, e.g. for tests. `guesses` null = gave up after 50. */
export function manualContexto(puzzle: string, guesses: number | null, hints = 0): ContextoResult {
  return { puzzle, solved: guesses !== null, guesses: guesses ?? 50, hints };
}

export const contexto: GameAdapter<ContextoResult> = {
  id: "contexto",
  name: "Contexto",
  url: "https://contexto.me/en/",
  source: "contexto.me",
  color: "#8fb8de",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Find the word, click Share, then paste it here.",
  parseShareText: parseContexto,

  // Fewest guesses wins (hints don't matter). Giving up is last place,
  // tied with everyone else who gave up, however many guesses it took.
  compare: (a, b) => (a.solved && b.solved ? a.guesses - b.guesses : Number(!a.solved) - Number(!b.solved)),
  canWin: (r) => r.solved,
  // "24" guesses, "DNF" for giving up. Hints aren't shown: they're already
  // counted in the guesses and don't change the ranking.
  formatScore: (r) => (!r.solved ? "DNF" : String(r.guesses)),
  averageLabel: "Avg guesses",
  average(results) {
    const solved = results.filter((r) => r.solved);
    if (solved.length === 0) return null;
    return (solved.reduce((sum, r) => sum + r.guesses, 0) / solved.length).toFixed(1);
  },
};
