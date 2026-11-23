import { gridRows, normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

export type StrandsResult = {
  puzzle: string;
  /** Hints used. Fewer is better; Strands can't be lost. */
  hints: number;
  /** Words found: the theme words plus the spangram. */
  words: number;
  /** Which word found was the spangram, from 1. */
  spangram: number;
  /**
   * The share's emoji in order, one letter each: b = theme word (🔵),
   * s = spangram (🟡), h = hint (💡).
   */
  grid?: string;
};

/** Strands #1 was published on 2024-03-04. */
const EPOCH_UTC = Date.UTC(2024, 2, 3);
const DAY_MS = 86_400_000;

/** Strands resets at local midnight, like Wordle. */
export function strandsNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

const TILES: Record<string, string> = { "🔵": "b", "🟡": "s", "💡": "h" };
const TILE_SET: ReadonlySet<string> = new Set(Object.keys(TILES));
/** Longest share Scrim takes. Puzzles have well under 20 words, and hints come one per three wrong words. */
const MAX_TILES = 40;

const HEADER = /Strands\s*#\s*(\d[\d,.\s]*\d|\d)/iu;

/** Checks a share's emoji (as b/s/h letters) and works out the score from them. */
export function scoreStrandsGrid(grid: string): ParseResult<Omit<StrandsResult, "puzzle">> {
  if (!/^[bsh]+$/.test(grid) || grid.length > MAX_TILES) {
    return { ok: false, error: "That doesn't look like a Strands result." };
  }
  const spangrams = grid.split("s").length - 1;
  if (spangrams !== 1) {
    return { ok: false, error: "A finished Strands has exactly one spangram (🟡)." };
  }
  const found = grid.replace(/h/g, "");
  if (found.length < 2) return { ok: false, error: "That isn't a finished game: there are too few words." };
  return {
    ok: true,
    result: { hints: grid.length - found.length, words: found.length, spangram: found.indexOf("s") + 1, grid },
  };
}

export function parseStrands(text: string): ParseResult<StrandsResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    return { ok: false, error: "Invalid format for Strands score." };
  }
  const puzzle = String(Number(header[1].replace(/\D/g, "")));

  // The theme in quotes comes next; it's skipped, as it has no tiles in it.
  const found = gridRows(clean.slice((header.index ?? 0) + header[0].length), TILE_SET);
  if (!found.ok) return found;
  if (found.rows.length === 0) {
    return { ok: false, error: "Couldn't find the coloured dots. Paste the whole share text." };
  }
  // Strands puts four to a row; only the last can be shorter.
  const bad = found.rows.findIndex((r, i) => r.length > 4 || (i < found.rows.length - 1 && r.length !== 4));
  if (bad !== -1) return { ok: false, error: `Row ${bad + 1} should have 4 dots.` };
  const grid = found.rows.flat().map((c) => TILES[c]).join("");

  const scored = scoreStrandsGrid(grid);
  return scored.ok ? { ok: true, result: { puzzle, ...scored.result } } : scored;
}

/** A result without its emoji, e.g. for tests: `words` found, the spangram at `spangram`. */
export function manualStrands(puzzle: string, hints: number, words = 8, spangram = 1): StrandsResult {
  return { puzzle, hints, words, spangram };
}

export const strands: GameAdapter<StrandsResult> = {
  id: "strands",
  name: "Strands",
  url: "https://www.nytimes.com/games/strands",
  source: "The New York Times",
  color: "#e3c454",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish the puzzle, click Share, then paste it here.",
  parseShareText: parseStrands,

  // Fewest hints wins; everyone finishes, so anyone can win.
  compare: (a, b) => a.hints - b.hints,
  canWin: () => true,
  // Compact, like Connections: "⭐" for no hints, "2💡" for two.
  formatScore: (r) => (r.hints === 0 ? "⭐" : `${r.hints}💡`),
  averageLabel: "Avg hints",
  average(results) {
    if (results.length === 0) return null;
    return (results.reduce((sum, r) => sum + r.hints, 0) / results.length).toFixed(2);
  },
};
