import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Worldle (worldle.teuteuf.fr): guess the country from its outline in six
 * tries. Only the main country round counts, not the bonus rounds.
 */
export type WorldleResult = {
  puzzle: string;
  solved: boolean;
  /** 1–6 when solved, absent/null for X/6. */
  guesses?: number | null;
  /**
   * One string per guess, as the share draws it: five squares for how close
   * it was, g = green (20% each), y = yellow (10%), . = blank. "ggggg" is the
   * country itself.
   */
  grid?: string[];
};

/** Worldle #0 was 2022-01-21. Resets at local midnight, like Wordle. */
const EPOCH_UTC = Date.UTC(2022, 0, 21);
const DAY_MS = 86_400_000;
export const MAX_GUESSES = 6;

export function worldleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

// "#Worldle #1770 (26.11.2026) 4/6 (100%)", maybe with 🙈 or 🌀 after.
const HEADER = /#Worldle\s*#\s*(\d[\d,]*)\s*(?:\([\d./]+\)\s*)?([1-6Xx])\s*\/\s*6/iu;
const TILES: Record<string, string> = { "🟩": "g", "🟨": "y", "⬛": ".", "⬜": "." };
// Each row ends with the direction to the country, 🎉 for the country itself,
// or 🛟 when a lifesaver kept the streak after a miss.
const ROW_END = /(?:[⬆↗➡↘⬇↙⬅↖]|🎉|🛟)$/u;

/** What's wrong with a grid for this score, or null if it's a possible game. */
export function checkWorldleGrid(grid: string[], solved: boolean, guesses: number | null): string | null {
  const expected = guesses ?? MAX_GUESSES;
  if (grid.length !== expected) return `The grid has ${grid.length} rows but the score says ${expected}.`;
  for (let i = 0; i < grid.length; i++) {
    if (!/^g*y?\.*$/.test(grid[i]) || grid[i].length !== 5) return `Row ${i + 1} of the grid can't be right.`;
    if ((grid[i] === "ggggg") !== (solved && i === grid.length - 1)) return "The grid doesn't match the score.";
  }
  return null;
}

export function parseWorldle(text: string): ParseResult<WorldleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Worldle score." };
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = header[2].toUpperCase() !== "X";
  const guesses = solved ? Number(header[2]) : null;

  const grid: string[] = [];
  let ended = false;
  for (const line of clean.slice((header.index ?? 0) + header[0].length).split(/\r?\n/)) {
    const chars = Array.from(line.replace(/\s/g, "").replace(ROW_END, ""));
    if (!chars.some((c) => c in TILES)) {
      if (grid.length) ended = true;
      continue;
    }
    if (ended) return { ok: false, error: "The grid should be one block of rows, with nothing between them." };
    if (!chars.every((c) => c in TILES)) {
      return { ok: false, error: `Row ${grid.length + 1} of the grid has something other than squares in it.` };
    }
    grid.push(chars.map((c) => TILES[c]).join(""));
  }
  if (grid.length === 0) return { ok: false, error: "Couldn't find the coloured grid. Paste the whole share text." };

  const problem = checkWorldleGrid(grid, solved, guesses);
  return problem ? { ok: false, error: problem } : { ok: true, result: { puzzle, solved, guesses, grid } };
}

export function manualWorldle(puzzle: string, guesses: number | null): WorldleResult {
  return { puzzle, solved: guesses !== null, guesses };
}

/** 1–6 for solves, 7 for a miss. Lower is better. */
function points(r: WorldleResult): number {
  return r.solved && r.guesses ? r.guesses : 7;
}

export const worldle: GameAdapter<WorldleResult> = {
  id: "worldle",
  name: "Worldle",
  url: "https://worldle.teuteuf.fr/",
  source: "worldle.teuteuf.fr",
  color: "#7d9be0",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish today's country, click Share, then paste it here.",
  parseShareText: parseWorldle,

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
