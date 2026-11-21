import { gridRows, normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

export type ConnectionsResult = {
  puzzle: string;
  /** All four groups found before the fourth mistake. */
  solved: boolean;
  /** 0–3 when solved; 4 when the game ended on mistakes. */
  mistakes: number;
  /** Groups found, 0–4. */
  groups: number;
  /** One string per guess, colours y/g/b/p (yellow, green, blue, purple). */
  grid?: string[];
};

/** Connections #1 was published on 2023-06-12. */
const EPOCH_UTC = Date.UTC(2023, 5, 11);
const DAY_MS = 86_400_000;

/** Connections resets at local midnight, like Wordle. */
export function connectionsNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

const SQUARES: Record<string, string> = { "🟨": "y", "🟩": "g", "🟦": "b", "🟪": "p" };
const SQUARE_SET: ReadonlySet<string> = new Set(Object.keys(SQUARES));

const HEADER = /Connections\s*(?:\r?\n|\s)*Puzzle\s*#\s*(\d[\d,.\s]*\d|\d)/iu;

/** Checks that a grid is a finished game, and works out the score from it. */
export function scoreConnectionsGrid(grid: string[]): ParseResult<Omit<ConnectionsResult, "puzzle">> {
  if (grid.length === 0 || grid.length > 7 || grid.some((r) => !/^[ygbp]{4}$/.test(r))) {
    return { ok: false, error: "That grid doesn't look like a Connections result." };
  }
  const isGroup = (r: string) => r === r[0].repeat(4);
  const found = grid.filter(isGroup);
  const groups = found.length;
  const mistakes = grid.length - groups;
  if (new Set(found).size !== groups) return { ok: false, error: "The grid has the same group twice." };
  // Once a group is found its cards leave the board, so its colour can't come up again.
  for (let i = 0; i < grid.length; i++) {
    if (isGroup(grid[i]) && grid.slice(i + 1).some((r) => r.includes(grid[i][0]))) {
      return { ok: false, error: "That grid isn't possible: a found group's colour shows up again." };
    }
  }
  const solved = groups === 4;
  const last = grid[grid.length - 1];
  if (solved ? mistakes > 3 || !isGroup(last) : mistakes !== 4 || isGroup(last)) {
    return { ok: false, error: "That grid isn't a finished game." };
  }
  return { ok: true, result: { solved, mistakes, groups, grid } };
}

export function parseConnections(text: string): ParseResult<ConnectionsResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    return { ok: false, error: "Invalid format for Connections score." };
  }
  const puzzle = String(Number(header[1].replace(/\D/g, "")));

  const found = gridRows(clean.slice((header.index ?? 0) + header[0].length), SQUARE_SET);
  if (!found.ok) return found;
  if (found.rows.length === 0) {
    return { ok: false, error: "Couldn't find the coloured grid. Paste the whole share text." };
  }
  const bad = found.rows.findIndex((r) => r.length !== 4);
  if (bad !== -1) return { ok: false, error: `Row ${bad + 1} of the grid should have 4 squares.` };
  const grid = found.rows.map((r) => r.map((c) => SQUARES[c]).join(""));

  const scored = scoreConnectionsGrid(grid);
  return scored.ok ? { ok: true, result: { puzzle, ...scored.result } } : scored;
}

/** Manual entry: mistakes 0–3 for a solve, or `null` for a loss with `groups` found. */
export function manualConnections(puzzle: string, mistakes: number | null, groups = 0): ConnectionsResult {
  return mistakes === null
    ? { puzzle, solved: false, mistakes: 4, groups }
    : { puzzle, solved: true, mistakes, groups: 4 };
}

/** 0–3 for solves (mistakes); losses rank below, more groups found first. Lower is better. */
function points(r: ConnectionsResult): number {
  return r.solved ? r.mistakes : 8 - r.groups;
}

export const connections: GameAdapter<ConnectionsResult> = {
  id: "connections",
  name: "Connections",
  url: "https://www.nytimes.com/games/connections",
  source: "The New York Times",
  color: "#b18ad8",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish the puzzle, click Share Your Results, then paste it here.",
  parseShareText: parseConnections,

  compare: (a, b) => points(a) - points(b),
  canWin: (r) => r.solved,
  formatScore: (r) =>
    r.solved ? (r.mistakes === 0 ? "Perfect" : `${r.mistakes} mistake${r.mistakes === 1 ? "" : "s"}`) : `X · ${r.groups}/4`,
  averageLabel: "Avg mistakes",
  average(results) {
    const solved = results.filter((r) => r.solved);
    if (solved.length === 0) return null;
    return (solved.reduce((sum, r) => sum + r.mistakes, 0) / solved.length).toFixed(2);
  },
};
