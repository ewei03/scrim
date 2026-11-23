import { gridRows, normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Poople (poople.io): a word ladder from the day's four-letter word to POOP,
 * changing one letter at a time. Fewest steps wins. You can't lose: the game
 * only ends at POOP.
 */
export type PoopleResult = {
  puzzle: string;
  /** Words played after the starting word, POOP included. */
  guesses: number;
  /** The shortest possible path, as Poople reports it. */
  best?: number;
  /**
   * The share's rows, starting word first: one per word, "p" where a letter
   * matches POOP and "." where it doesn't. The last row is "pppp".
   */
  grid?: string[];
};

/** Most steps Scrim takes (Poople has no limit; this keeps scores sane). */
export const MAX_GUESSES = 99;

/**
 * Poople #1 was 2025-08-15. One puzzle worldwide, which changes at 08:00 UTC
 * (midnight in UTC−8, all year round).
 */
const EPOCH_UTC = Date.UTC(2025, 7, 14);
const DAY_MS = 86_400_000;
export const ZONE = "Etc/GMT+8";

export function poopleNumberFor(date: Date): number {
  return Math.floor((date.getTime() - 8 * 3_600_000 - EPOCH_UTC) / DAY_MS);
}

const HEADER = /Poople\s*#\s*(\d[\d,]*)\s+(\d+)\s*\/\s*(\d+)/iu;
const TILES: ReadonlySet<string> = new Set(["🟫", "⬜"]);

/** What's wrong with a result, or null if it's a possible game. */
export function checkPoople(r: Omit<PoopleResult, "puzzle">): string | null {
  if (!Number.isInteger(r.guesses) || r.guesses < 1 || r.guesses > MAX_GUESSES) {
    return `Steps must be between 1 and ${MAX_GUESSES}.`;
  }
  if (r.best !== undefined && (!Number.isInteger(r.best) || r.best < 1 || r.best > r.guesses)) {
    return "That can't beat the shortest path.";
  }
  if (r.grid) {
    if (r.grid.length !== r.guesses + 1) return "The grid doesn't match the steps.";
    if (r.grid.some((row) => !/^[p.]{4}$/.test(row))) return "Every word in Poople has four letters.";
    if (r.grid.at(-1) !== "pppp") return "A finished Poople ends at POOP.";
    if (r.grid.slice(0, -1).includes("pppp")) return "A finished Poople ends at POOP.";
    for (let i = 1; i < r.grid.length; i++) {
      const changed = Array.from(r.grid[i]).filter((c, j) => c !== r.grid![i - 1][j]).length;
      if (changed > 1) return "Each word changes only one letter.";
    }
  }
  return null;
}

export function parsePoople(text: string): ParseResult<PoopleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Poople score." };
  const puzzle = String(Number(header[1].replace(/\D/g, "")));
  const guesses = Number(header[2]);
  const best = Number(header[3]);

  const found = gridRows(clean.slice((header.index ?? 0) + header[0].length), TILES);
  if (!found.ok) return found;
  if (found.rows.length === 0) return { ok: false, error: "Couldn't find the grid. Paste the whole share text." };
  const grid = found.rows.map((row) => row.map((c) => (c === "🟫" ? "p" : ".")).join(""));

  const result = { puzzle, guesses, best, grid };
  const problem = checkPoople(result);
  return problem ? { ok: false, error: problem } : { ok: true, result };
}

/** A result without its grid, e.g. for tests. */
export function manualPoople(puzzle: string, guesses: number, best?: number): PoopleResult {
  return best === undefined ? { puzzle, guesses } : { puzzle, guesses, best };
}

export const poople: GameAdapter<PoopleResult> = {
  id: "poople",
  name: "Poople",
  url: "https://poople.io/",
  source: "poople.io",
  color: "#c9a27a",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  zone: ZONE,
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Reach POOP, click Copy results, then paste it here.",
  parseShareText: parsePoople,

  // Everyone starts from the same word, so fewest steps wins.
  compare: (a, b) => a.guesses - b.guesses,
  canWin: () => true,
  // "6/4": six steps where four was the shortest. "⭐" for matching it.
  formatScore: (r) => (r.best === undefined ? String(r.guesses) : r.guesses === r.best ? "⭐" : `${r.guesses}/${r.best}`),
  // Steps over the shortest path, so days with long and short ladders compare.
  averageLabel: "Avg extra steps",
  average(results) {
    const known = results.filter((r) => r.best !== undefined);
    if (known.length === 0) return null;
    return (known.reduce((sum, r) => sum + r.guesses - r.best!, 0) / known.length).toFixed(1);
  },
};
