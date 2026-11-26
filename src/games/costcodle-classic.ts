import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Costcodle Classic (costcodle.com, the other mode beside Checkout): guess
 * one Costco product's price in six tries. Within 5% wins; each miss says
 * higher or lower, and whether it was within 25%. Ranked like Wordle.
 */
export type CostcodleClassicResult = {
  puzzle: string;
  solved: boolean;
  /** 1–6 when solved, absent/null for X/6. */
  guesses?: number | null;
  /**
   * One string per guess, as the share draws it: "u" (go higher) or "d" (go
   * lower), then "y" (within 25%, yellow) or "r" (further, red). "w" is the
   * winning guess.
   */
  grid?: string[];
};

export const MAX_GUESSES = 6;

/**
 * Costcodle numbers its days from 2023-09-21 (as #2), by local date, so #0 is
 * 2023-09-19. Classic uses these numbers; Checkout counts from its own launch.
 * Resets at local midnight, like Wordle.
 */
const EPOCH_UTC = Date.UTC(2023, 8, 19);
const DAY_MS = 86_400_000;

export function costcodleClassicNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

// "Costcodle Classic #1164 3/6"
const HEADER = /Costcodle\s+Classic\s*#\s*(\d[\d,]*)\s+([1-6Xx])\s*\/\s*6/iu;
// Each row: ⬆️ or ⬇️ then 🟥 or 🟨, or ✅ alone for the price.
const ROW = /^(?:([⬆⬇])(🟥|🟨)|✅)$/u;

/** What's wrong with a grid for this score, or null if it's a possible game. */
export function checkClassicGrid(grid: string[], solved: boolean, guesses: number | null): string | null {
  const expected = guesses ?? MAX_GUESSES;
  if (grid.length !== expected) return `The share has ${grid.length} guesses but the score says ${expected}.`;
  for (let i = 0; i < grid.length; i++) {
    if (!/^(?:[ud][yr]|w)$/.test(grid[i])) return `Guess ${i + 1} in the share can't be right.`;
    if ((grid[i] === "w") !== (solved && i === grid.length - 1)) return "The guesses don't match the score.";
  }
  return null;
}

export function parseCostcodleClassic(text: string): ParseResult<CostcodleClassicResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    if (/Costcodle\s+Checkout\s*#/iu.test(clean)) {
      return { ok: false, error: "That's Costcodle Checkout. Paste it under Costcodle Checkout instead." };
    }
    return { ok: false, error: "Invalid format for Costcodle Classic score." };
  }
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = header[2].toUpperCase() !== "X";
  const guesses = solved ? Number(header[2]) : null;

  const grid: string[] = [];
  let ended = false;
  for (const line of clean.slice((header.index ?? 0) + header[0].length).split(/\r?\n/)) {
    const row = line.replace(/\s/g, "");
    if (!row) {
      if (grid.length) ended = true;
      continue;
    }
    const m = row.match(ROW);
    if (!m) {
      // The "Play now at …" line, or anything else after the guesses.
      if (grid.length) ended = true;
      continue;
    }
    if (ended) return { ok: false, error: "The guesses should be one block of rows, with nothing between them." };
    grid.push(m[1] ? (m[1] === "⬆" ? "u" : "d") + (m[2] === "🟨" ? "y" : "r") : "w");
  }
  if (grid.length === 0) return { ok: false, error: "Couldn't find your guesses. Paste the whole share text." };

  const problem = checkClassicGrid(grid, solved, guesses);
  return problem ? { ok: false, error: problem } : { ok: true, result: { puzzle, solved, guesses, grid } };
}

export function manualCostcodleClassic(puzzle: string, guesses: number | null): CostcodleClassicResult {
  return { puzzle, solved: guesses !== null, guesses };
}

/** 1–6 for solves, 7 for a miss. Lower is better. */
function points(r: CostcodleClassicResult): number {
  return r.solved && r.guesses ? r.guesses : 7;
}

export const costcodleClassic: GameAdapter<CostcodleClassicResult> = {
  id: "costcodleclassic",
  name: "Costcodle Classic",
  url: "https://costcodle.com/",
  source: "costcodle.com",
  // The same as Checkout: they show as one game.
  color: "#e8908c",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Switch Costcodle to Classic, finish today's item, click Share, then paste it here.",
  parseShareText: parseCostcodleClassic,

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
