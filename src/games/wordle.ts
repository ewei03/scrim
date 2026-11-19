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

export function parseWordle(text: string): ParseResult<WordleResult> {
  const clean = text.replace(/️/g, "");
  const header = clean.match(HEADER);
  if (!header) {
    return { ok: false, error: "Couldn't find a Wordle score. It should start like “Wordle 1,612 4/6”." };
  }

  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const solved = header[2].toUpperCase() !== "X";
  const guesses = solved ? Number(header[2]) : null;
  const hard = header[3] === "*";

  const grid: string[] = [];
  for (const line of clean.slice((header.index ?? 0) + header[0].length).split(/\r?\n/)) {
    const chars = Array.from(line.trim());
    if (chars.length === 5 && chars.every((c) => c in TILES)) {
      grid.push(chars.map((c) => TILES[c]).join(""));
    }
  }

  const result: WordleResult = { puzzle, solved, guesses, hard };

  if (grid.length > 0) {
    const expected = guesses ?? 6;
    if (grid.length !== expected) {
      return { ok: false, error: `The grid has ${grid.length} rows but the score says ${expected}.` };
    }
    for (let i = 0; i < grid.length; i++) {
      const allGreen = grid[i] === "ggggg";
      const isLastSolved = solved && i === grid.length - 1;
      if (allGreen !== isLastSolved) {
        return { ok: false, error: "The grid doesn't match the score." };
      }
    }
    result.grid = grid;
  }

  return { ok: true, result };
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
  blurb: "Guess the five-letter word in six tries. Fewest guesses wins; ties share the win.",
  free: true,

  currentPuzzleId: (now = new Date()) => String(wordleNumberFor(now)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,

  shareHint: "Finish the Wordle, click Share, then paste it here.",
  parseShareText: parseWordle,

  compare: (a, b) => points(a) - points(b),
  canWin: (r) => r.solved,
  formatScore: (r) => `${r.solved ? r.guesses : "X"}/6${r.hard ? "*" : ""}`,
  averageLabel: "Avg",
  average(results) {
    const solved = results.filter((r) => r.solved && r.guesses);
    if (solved.length === 0) return null;
    const avg = solved.reduce((sum, r) => sum + (r.guesses ?? 0), 0) / solved.length;
    return avg.toFixed(2);
  },
};
