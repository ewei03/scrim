import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Angledle (angledle.com), the daily Guess: find the angle (1–359°) in six
 * tries. Its other daily games (Draw It, Higher/Lower) aren't counted.
 */
export type AngledleResult = {
  puzzle: string;
  solved: boolean;
  /** 1–6 when solved, absent/null for X/6. */
  guesses?: number | null;
  /**
   * One row per guess: how close (g within 5°, y 15°, o 30°, r further),
   * then which way to go next (u higher, d lower, c got it). The daily
   * summary's share has no arrows, so its rows are just the closeness.
   */
  grid?: string[];
};

/**
 * Angledle numbers days from 2022-01-01 by the player's local date, but its
 * day starts at 6 am: before then it still shows the day before's puzzle.
 */
const EPOCH_UTC = Date.UTC(2022, 0, 1);
const DAY_MS = 86_400_000;
export const MAX_GUESSES = 6;

export function angledleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

// The Guess's own share: "Angledle #1790 3/6", then "🔴 ↑" per guess
// (colour-blind: 🔵 and ⚫). The daily summary's: "Angledle #1790", then
// "Guess 3/6 🔴🟡🟢" (and lines for Draw It and Higher or Lower).
const HEADER = /Angledle\s+#\s*(\d[\d,]*)\s+([1-6Xx])\s*\/\s*6/iu;
const SUMMARY_HEADER = /Angledle\s+#\s*(\d[\d,]*)\s*$/imu;
const SUMMARY_GUESS = /^\s*Guess\s+([1-6Xx])\s*\/\s*6\s+((?:🟢|🔵|🟡|🟠|🔴|⚫)+)\s*$/imu;
const CLOSENESS: Record<string, string> = { "🟢": "g", "🔵": "g", "🟡": "y", "🟠": "o", "🔴": "r", "⚫": "r" };
const WAY: Record<string, string> = { "↑": "u", "⬆": "u", "↓": "d", "⬇": "d", "✓": "c", "✔": "c", "✅": "c" };
const ROW = /^\s*(🟢|🔵|🟡|🟠|🔴|⚫)\s*(↑|⬆|↓|⬇|✓|✔|✅)\s*$/u;

/** What's wrong with a grid for this score, or null if it's a possible game. */
export function checkAngledleGrid(grid: string[], solved: boolean, guesses: number | null): string | null {
  const expected = guesses ?? MAX_GUESSES;
  if (grid.length !== expected) return `The grid has ${grid.length} rows but the score says ${expected}.`;
  // With arrows (the Guess's share) or without (the daily summary's), not a mix.
  const arrows = grid[0]?.length === 2;
  for (let i = 0; i < grid.length; i++) {
    if (!(arrows ? /^(g[udc]|[yor][ud])$/ : /^[gyor]$/).test(grid[i])) return `Row ${i + 1} of the grid doesn't look right.`;
    if (arrows && (grid[i] === "gc") !== (solved && i === grid.length - 1)) return "The grid doesn't match the score.";
  }
  if (!arrows && solved && grid[grid.length - 1] !== "g") return "The grid doesn't match the score.";
  return null;
}

export function parseAngledle(text: string): ParseResult<AngledleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return parseSummary(clean);
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = header[2].toUpperCase() !== "X";
  const guesses = solved ? Number(header[2]) : null;

  const grid: string[] = [];
  for (const line of clean.slice((header.index ?? 0) + header[0].length).split(/\r?\n/)) {
    const m = line.match(ROW);
    if (m) grid.push(CLOSENESS[m[1]] + WAY[m[2]]);
    else if (grid.length && line.trim()) break;
  }
  if (grid.length === 0) return { ok: false, error: "Couldn't find your guesses. Paste the whole share text." };
  const problem = checkAngledleGrid(grid, solved, guesses);
  return problem ? { ok: false, error: problem } : { ok: true, result: { puzzle, solved, guesses, grid } };
}

/** The daily summary's share: only its Guess line counts. */
function parseSummary(clean: string): ParseResult<AngledleResult> {
  const header = clean.match(SUMMARY_HEADER);
  const line = header && clean.slice((header.index ?? 0) + header[0].length).match(SUMMARY_GUESS);
  if (!header || !line) return { ok: false, error: "Invalid format for Angledle score." };
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = line[1].toUpperCase() !== "X";
  const guesses = solved ? Number(line[1]) : null;
  const grid = Array.from(line[2], (c) => CLOSENESS[c]);
  const problem = checkAngledleGrid(grid, solved, guesses);
  return problem ? { ok: false, error: problem } : { ok: true, result: { puzzle, solved, guesses, grid } };
}

export function manualAngledle(puzzle: string, guesses: number | null): AngledleResult {
  return { puzzle, solved: guesses !== null, guesses };
}

/** 1–6 for solves, 7 for a miss. Lower is better. */
function points(r: AngledleResult): number {
  return r.solved && r.guesses ? r.guesses : 7;
}

export const angledle: GameAdapter<AngledleResult> = {
  id: "angledle",
  name: "Angledle",
  url: "https://angledle.com/",
  source: "angledle.com",
  color: "#e9a47e",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish today's Guess, copy its result (or the daily summary), then paste it here.",
  parseShareText: parseAngledle,

  compare: (a, b) => points(a) - points(b),
  canWin: (r) => r.solved,
  formatScore: (r) => `${r.solved ? r.guesses : "X"}/6`,
  averageLabel: "Avg guesses",
  average(results) {
    const solved = results.filter((r) => r.solved && r.guesses);
    if (solved.length === 0) return null;
    return (solved.reduce((sum, r) => sum + (r.guesses ?? 0), 0) / solved.length).toFixed(2);
  },
};
