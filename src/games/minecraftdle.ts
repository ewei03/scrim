import { dateIn } from "@/lib/time";
import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Minecraftdle (minecraftdle.com): guess the day's Minecraft block, item or
 * mob; every guess shows how close each of its traits is. Guesses are
 * unlimited and the daily can't be lost, so everyone who finishes counts:
 * fewest tries wins. Each mode is its own game (see modes.ts).
 */
export type MinecraftdleResult = {
  puzzle: string;
  /** Tries it took, the right answer included. */
  guesses: number;
  /**
   * One string per guess, a character per trait after the name: c correct,
   * x wrong, u higher, d lower. Absent when the share was cut short (it lists
   * 10 guesses at most).
   */
  grid?: string[];
};

/**
 * Minecraftdle #1 was 2026-11-10. One puzzle worldwide per mode, all three
 * with the same number, which changes at midnight in Madrid.
 */
const EPOCH_UTC = Date.UTC(2026, 10, 9);
const DAY_MS = 86_400_000;
export const ZONE = "Europe/Madrid";
export const MAX_GUESSES = 999;

export const MODES = [
  { id: "minecraftdle", path: "blocks", noun: "Block", label: "Block" },
  { id: "minecraftdleitem", path: "items", noun: "Item", label: "Item" },
  { id: "minecraftdlemob", path: "mobs", noun: "Mob", label: "Mob" },
] as const;

export function minecraftdleNumberFor(date: Date): number {
  const [y, m, d] = dateIn(ZONE, date);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

// "Minecraftdle #18 · Block", then "3 tries · streak 2" (no streak below 2).
const HEADER = /Minecraftdle\s+#\s*(\d[\d,]*)\s*[·•\-–—]\s*([A-Za-z]+)/iu;
const SUMMARY = /^\s*(\d+)\s+tr(?:y|ies)\b/imu;
const SQUARES: Record<string, string> = { "🟩": "c", "🟥": "x", "⬆": "u", "⬇": "d" };
const ROW = /^[🟩🟥⬆⬇]+$/u;

export function checkMinecraftdle(r: Omit<MinecraftdleResult, "puzzle">): string | null {
  if (!Number.isInteger(r.guesses) || r.guesses < 1 || r.guesses > MAX_GUESSES) {
    return `Tries must be between 1 and ${MAX_GUESSES}.`;
  }
  if (r.grid) {
    if (r.grid.length !== r.guesses) return `The grid has ${r.grid.length} rows but the score says ${r.guesses}.`;
    if (r.grid.some((row) => !/^[cxud]{1,12}$/.test(row) || row.length !== r.grid![0].length)) {
      return "The grid doesn't look right.";
    }
    // The answer's row is all green. Other rows can be too: a guess with every
    // trait right but the wrong name (the share leaves the name out).
    if (!r.grid.some((row) => /^c+$/.test(row))) return "A finished Minecraftdle has the answer in it.";
  }
  return null;
}

/** Parses a share for one mode (the share names its mode: Block, Item or Mob). */
export function parseMinecraftdle(text: string, mode: (typeof MODES)[number]): ParseResult<MinecraftdleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Minecraftdle score." };
  const shared = MODES.find((m) => m.noun.toLowerCase() === header[2].toLowerCase());
  if (!shared) return { ok: false, error: "Couldn't tell which Minecraftdle that is." };
  if (shared.id !== mode.id) return { ok: false, error: `That's Minecraftdle ${shared.label}, not ${mode.label}.` };
  const puzzle = String(Number(header[1].replace(/\D/g, "")));

  const rest = clean.slice((header.index ?? 0) + header[0].length);
  const summary = rest.match(SUMMARY);
  if (!summary) return { ok: false, error: "Couldn't find your tries. Finish today's game, then paste the whole share text." };
  const guesses = Number(summary[1]);

  const lines = rest
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, ""))
    .filter((l) => ROW.test(l));
  const grid = lines.map((l) => Array.from(l, (c) => SQUARES[c]).join(""));
  // The share lists 10 guesses at most; keep the grid only when it's whole.
  const result: MinecraftdleResult = grid.length === guesses ? { puzzle, guesses, grid } : { puzzle, guesses };
  const problem = checkMinecraftdle(result);
  return problem ? { ok: false, error: problem } : { ok: true, result };
}

function adapter(mode: (typeof MODES)[number]): GameAdapter<MinecraftdleResult> {
  return {
    id: mode.id,
    name: `Minecraftdle (${mode.label})`,
    url: `https://minecraftdle.com/${mode.path}`,
    source: "minecraftdle.com",
    color: "#8cc46b",
    free: true,

    puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
    zone: ZONE,
    puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
    autoSubmit: true,

    shareHint: `Find today's ${mode.noun.toLowerCase()} in the Daily, click Share, then paste it here.`,
    parseShareText: (text) => parseMinecraftdle(text, mode),

    compare: (a, b) => a.guesses - b.guesses,
    canWin: () => true,
    formatScore: (r) => String(r.guesses),
    averageLabel: "Avg tries",
    average(results) {
      if (results.length === 0) return null;
      return (results.reduce((sum, r) => sum + r.guesses, 0) / results.length).toFixed(1);
    },
  };
}

export const minecraftdle = adapter(MODES[0]);
export const minecraftdleItem = adapter(MODES[1]);
export const minecraftdleMob = adapter(MODES[2]);
