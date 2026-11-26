import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Globle (globle-game.com): find the mystery country, guided by how hot each
 * guess is. Guesses are unlimited, so everyone finishes; fewest wins.
 */
export type GlobleResult = {
  puzzle: string;
  guesses: number;
};

/**
 * Globle has no puzzle numbers, only dates, so Scrim numbers its days from
 * 2022-01-01 and shows the date. Resets at local midnight.
 */
const EPOCH_UTC = Date.UTC(2022, 0, 1);
const DAY_MS = 86_400_000;
/** There are under 200 countries to guess. */
export const MAX_GUESSES = 199;

export function globleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

/** "2026-11-26" -> its number. */
export function globleNumberFromDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "🌎 Nov 26, 2026 🌍", then "🔥 3 | Avg. Guesses: 5.2", then "🟧🟨🟩 = 7".
const HEADER = /🌎\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\s*🌍/u;
const SCORE = /=\s*(\d+)\s*(?:$|\n)/mu;

export function checkGloble(r: Omit<GlobleResult, "puzzle">): string | null {
  if (!Number.isInteger(r.guesses) || r.guesses < 1 || r.guesses > MAX_GUESSES) {
    return `Guesses must be between 1 and ${MAX_GUESSES}.`;
  }
  return null;
}

export function parseGloble(text: string): ParseResult<GlobleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Globle score." };
  const month = MONTHS.indexOf(header[1].toLowerCase());
  if (month === -1) return { ok: false, error: "Couldn't read the date in that share." };
  const puzzle = String(Math.round((Date.UTC(Number(header[3]), month, Number(header[2])) - EPOCH_UTC) / DAY_MS));

  const score = clean.slice((header.index ?? 0) + header[0].length).match(SCORE);
  if (!score) return { ok: false, error: "Couldn't find your guesses. Win today's game, then paste the whole share text." };
  const result = { puzzle, guesses: Number(score[1]) };
  const problem = checkGloble(result);
  return problem ? { ok: false, error: problem } : { ok: true, result };
}

export const globle: GameAdapter<GlobleResult> = {
  id: "globle",
  name: "Globle",
  url: "https://globle-game.com/",
  source: "globle-game.com",
  color: "#e88fb4",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  // "Nov 26": Globle goes by date.
  puzzleLabel: (id) =>
    new Date(EPOCH_UTC + Number(id) * DAY_MS).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  autoSubmit: true,

  shareHint: "Find today's country, open Statistics, click Share, then paste it here.",
  parseShareText: parseGloble,

  compare: (a, b) => a.guesses - b.guesses,
  canWin: () => true,
  formatScore: (r) => String(r.guesses),
  averageLabel: "Avg guesses",
  average(results) {
    if (results.length === 0) return null;
    return (results.reduce((sum, r) => sum + r.guesses, 0) / results.length).toFixed(1);
  },
};
