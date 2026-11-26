import { dateIn } from "@/lib/time";
import { gridRows, normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Nerdle (nerdlegame.com), the classic eight-character daily: find the
 * equation in six tries. Mini, Maxi, Speed and the other modes aren't
 * supported.
 */
export type NerdleResult = {
  puzzle: string;
  solved: boolean;
  /** 1–6 when solved, absent/null for X/6. */
  guesses?: number | null;
  /** One string per guess: g = correct, p = present (purple), . = absent. */
  grid?: string[];
};

/**
 * Nerdle #1 was 2022-01-20. One puzzle worldwide, which changes at midnight
 * UTC (unless the player switched Nerdle to local time).
 */
const EPOCH_UTC = Date.UTC(2022, 0, 19);
const DAY_MS = 86_400_000;
export const ZONE = "UTC";
export const WIDTH = 8;
export const MAX_GUESSES = 6;

export function nerdleNumberFor(date: Date): number {
  const [y, m, d] = dateIn(ZONE, date);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

// "nerdlegame 1772 3/6". Other modes put theirs first ("mini nerdlegame …").
const HEADER = /(^|\s)nerdlegame\s+(\d[\d,]*)\s+([1-6Xx])\s*\/\s*6/iu;
const OTHER_MODE = /(micro|mini|midi|maxi|speed|pro|instant)\s+nerdlegame/iu;
const TILES: Record<string, string> = { "🟩": "g", "🟪": "p", "⬛": ".", "⬜": "." };
const TILE_SET: ReadonlySet<string> = new Set(Object.keys(TILES));

/** What's wrong with a grid for this score, or null if it's a possible game. */
export function checkNerdleGrid(grid: string[], solved: boolean, guesses: number | null): string | null {
  const expected = guesses ?? MAX_GUESSES;
  if (grid.length !== expected) return `The grid has ${grid.length} rows but the score says ${expected}.`;
  const done = "g".repeat(WIDTH);
  for (let i = 0; i < grid.length; i++) {
    if (!new RegExp(`^[gp.]{${WIDTH}}$`).test(grid[i])) return `Row ${i + 1} of the grid should have ${WIDTH} squares.`;
    if ((grid[i] === done) !== (solved && i === grid.length - 1)) return "The grid doesn't match the score.";
  }
  return null;
}

export function parseNerdle(text: string): ParseResult<NerdleResult> {
  const clean = normalizeShareText(text);
  if (OTHER_MODE.test(clean)) return { ok: false, error: "Only classic Nerdle counts." };
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Nerdle score." };
  const puzzle = String(Number(header[2].replace(/\D/g, "")));
  const solved = header[3].toUpperCase() !== "X";
  const guesses = solved ? Number(header[3]) : null;

  const found = gridRows(clean.slice((header.index ?? 0) + header[0].length), TILE_SET);
  if (!found.ok) return found;
  if (found.rows.length === 0) return { ok: false, error: "Couldn't find the coloured grid. Paste the whole share text." };
  const grid = found.rows.map((r) => r.map((c) => TILES[c]).join(""));

  const problem = checkNerdleGrid(grid, solved, guesses);
  return problem ? { ok: false, error: problem } : { ok: true, result: { puzzle, solved, guesses, grid } };
}

export function manualNerdle(puzzle: string, guesses: number | null): NerdleResult {
  return { puzzle, solved: guesses !== null, guesses };
}

/** 1–6 for solves, 7 for a miss. Lower is better. */
function points(r: NerdleResult): number {
  return r.solved && r.guesses ? r.guesses : 7;
}

export const nerdle: GameAdapter<NerdleResult> = {
  id: "nerdle",
  name: "Nerdle",
  url: "https://nerdlegame.com/",
  source: "nerdlegame.com",
  color: "#c27bb0",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  zone: ZONE,
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish classic Nerdle, click Share, then paste it here.",
  parseShareText: parseNerdle,

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
