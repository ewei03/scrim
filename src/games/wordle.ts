import { gridRows, normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

export type WordleResult = {
  puzzle: string;
  solved: boolean;
  /** 1–6 when solved, absent/null for X/6. */
  guesses?: number | null;
  hard: boolean;
  /** One string per guess: g = correct, y = present, . = absent. */
  grid?: string[];
};

/** Wordle #0 was published on 2021-06-19. */
const EPOCH_UTC = Date.UTC(2021, 5, 19);
const DAY_MS = 86_400_000;

/** Wordle resets at local midnight, so the number depends on the player's calendar date. */
export function wordleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

// Standard, dark-mode and high-contrast tiles.
const TILES: Record<string, string> = {
  "🟩": "g",
  "🟧": "g",
  "🟨": "y",
  "🟦": "y",
  "⬛": ".",
  "⬜": ".",
};

const HEADER = /Wordle\s+(\d[\d,.\s  ]*?)\s+([1-6Xx])\/6(\*)?/u;

const TILE_SET: ReadonlySet<string> = new Set(Object.keys(TILES));

export function parseWordle(text: string): ParseResult<WordleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    return { ok: false, error: "Invalid format for Wordle score." };
  }

  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = header[2].toUpperCase() !== "X";
  const guesses = solved ? Number(header[2]) : null;
  const hard = header[3] === "*";

  const found = gridRows(clean.slice((header.index ?? 0) + header[0].length), TILE_SET);
  if (!found.ok) return found;
  if (found.rows.length === 0) {
    return { ok: false, error: "Couldn't find the coloured grid. Paste the whole share text." };
  }
  const bad = found.rows.findIndex((r) => r.length !== 5);
  if (bad !== -1) return { ok: false, error: `Row ${bad + 1} of the grid should have 5 squares.` };
  const grid = found.rows.map((r) => r.map((c) => TILES[c]).join(""));

  const problem = checkWordleGrid(grid, solved, guesses, hard);
  if (problem) return { ok: false, error: problem };
  return { ok: true, result: { puzzle, solved, guesses, hard, grid } };
}

/** What's wrong with a grid for this score, or null if it's a possible game. */
export function checkWordleGrid(grid: string[], solved: boolean, guesses: number | null, hard: boolean): string | null {
  const expected = guesses ?? 6;
  if (grid.length !== expected) return `The grid has ${grid.length} rows but the score says ${expected}.`;
  for (let i = 0; i < grid.length; i++) {
    const allGreen = grid[i] === "ggggg";
    if (allGreen !== (solved && i === grid.length - 1)) return "The grid doesn't match the score.";
  }
  // Hard mode: a letter found in the right spot has to stay there.
  if (hard) {
    for (let i = 1; i < grid.length; i++) {
      for (let p = 0; p < 5; p++) {
        if (grid[i - 1][p] === "g" && grid[i][p] !== "g") return "That grid breaks hard mode: a green square went away.";
      }
    }
  }
  return null;
}

export function manualWordle(puzzle: string, guesses: number | null, hard: boolean): WordleResult {
  return { puzzle, solved: guesses !== null, guesses, hard };
}

/** 1–6 for solves, 7 for a miss. Lower is better. */
function points(r: WordleResult): number {
  return r.solved && r.guesses ? r.guesses : 7;
}

export const wordle: GameAdapter<WordleResult> = {
  id: "wordle",
  name: "Wordle",
  url: "https://www.nytimes.com/games/wordle/index.html",
  source: "The New York Times",
  color: "#6aaa64",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish the Wordle, click Share, then paste it here.",
  sharePlaceholder: "Wordle 1,612 4/6\n\n⬛🟨⬛⬛⬛\n🟩⬛⬛🟨⬛\n🟩🟩⬛🟩⬛\n🟩🟩🟩🟩🟩",
  parseShareText: parseWordle,

  compare: (a, b) => points(a) - points(b),
  canWin: (r) => r.solved,
  formatScore: (r) => `${r.solved ? r.guesses : "X"}/6${r.hard ? "*" : ""}`,
  averageLabel: "Avg guesses",
  average(results) {
    const solved = results.filter((r) => r.solved && r.guesses);
    if (solved.length === 0) return null;
    const avg = solved.reduce((sum, r) => sum + (r.guesses ?? 0), 0) / solved.length;
    return avg.toFixed(2);
  },
};
