import { dateIn } from "@/lib/time";
import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Waffle (wafflegame.net), the daily: unscramble the grid in 15 swaps. It
 * takes at least 10, so 0–5 swaps are left over, one star each. Most stars
 * wins; running out of swaps is a loss. Deluxe and Royale aren't supported.
 */
export type WaffleResult = {
  puzzle: string;
  solved: boolean;
  /** Swaps left over (0–5) when solved; absent/null when not. */
  stars?: number | null;
};

/**
 * Waffle #0 was 2022-01-21. One puzzle worldwide, which changes at midnight
 * UTC (unless the player switched Waffle to local time).
 */
const EPOCH_UTC = Date.UTC(2022, 0, 21);
const DAY_MS = 86_400_000;
export const ZONE = "UTC";
export const MAX_STARS = 5;

export function waffleNumberFor(date: Date): number {
  const [y, m, d] = dateIn(ZONE, date);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

// "#waffle1770 3/5" (Deluxe and Royale shares start "#deluxewaffle" and "#waffleroyale").
const HEADER = /#waffle(\d+)\s+([0-5Xx])\s*\/\s*5/iu;

export function parseWaffle(text: string): ParseResult<WaffleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    if (/#(?:deluxewaffle|waffleroyale)/iu.test(clean)) return { ok: false, error: "Only the daily Waffle counts." };
    return { ok: false, error: "Invalid format for Waffle score." };
  }
  const puzzle = String(Number(header[1]));
  const solved = header[2].toUpperCase() !== "X";
  return { ok: true, result: { puzzle, solved, stars: solved ? Number(header[2]) : null } };
}

export function manualWaffle(puzzle: string, stars: number | null): WaffleResult {
  return { puzzle, solved: stars !== null, stars };
}

/** 0 for five stars to 5 for none, 6 for a loss. Lower is better. */
function points(r: WaffleResult): number {
  return r.solved ? MAX_STARS - (r.stars ?? 0) : MAX_STARS + 1;
}

export const waffle: GameAdapter<WaffleResult> = {
  id: "waffle",
  name: "Waffle",
  url: "https://wafflegame.net/daily",
  source: "wafflegame.net",
  color: "#e6a157",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  zone: ZONE,
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish the daily Waffle, click Share, then paste it here.",
  parseShareText: parseWaffle,

  compare: (a, b) => points(a) - points(b),
  canWin: (r) => r.solved,
  formatScore: (r) => (r.solved ? `${r.stars}⭐` : "X"),
  averageLabel: "Avg stars",
  average(results) {
    const solved = results.filter((r) => r.solved);
    if (solved.length === 0) return null;
    return (solved.reduce((sum, r) => sum + (r.stars ?? 0), 0) / solved.length).toFixed(2);
  },
};
