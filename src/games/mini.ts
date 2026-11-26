import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * The Mini Crossword (minicrossword.com), its Easy and Hard dailies, each its
 * own game in Scrim (shown together, with a switch). Fewest reveals wins,
 * then the fastest time. Archive and Unlimited puzzles aren't supported.
 */
export type MiniLevel = "easy" | "hard";

export type MiniResult = {
  puzzle: string;
  /** Solve time, in whole seconds (as the share shows it). */
  seconds: number;
  /** Cells revealed. */
  reveals: number;
};

/** Both dailies' #1 was 2026-06-22. Resets at local midnight, like Wordle. */
const EPOCH_UTC = Date.UTC(2026, 5, 21);
const DAY_MS = 86_400_000;
/** A day: longer than that and the timer can't be right. */
export const MAX_SECONDS = 86_400;
/** A 7×7 grid has 49 cells. */
export const MAX_REVEALS = 49;

export function miniNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

/** 83 -> "1:23", 45 -> "45s", as the Mini writes times. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}:${String(s).padStart(2, "0")}`;
}

// "Mini Crossword Easy #154: Title"
const HEADER = /Mini\s+Crossword\s+(Easy|Hard)\s*#\s*(\d[\d,]*)/iu;
// "1:23 | No reveals!" or "45s | Reveals: 2" (pauses and a rank may follow).
const LINE = /(?:^|\s)(?:(\d+):([0-5]\d)|(\d+)s)\s*\|\s*(?:No reveals!|Reveals:\s*(\d+))/imu;

/** What's wrong with a result, or null if it's a possible game. */
export function checkMini(r: Omit<MiniResult, "puzzle">): string | null {
  if (!Number.isInteger(r.seconds) || r.seconds < 0 || r.seconds > MAX_SECONDS) return "That time can't be right.";
  if (!Number.isInteger(r.reveals) || r.reveals < 0 || r.reveals > MAX_REVEALS) {
    return `Reveals must be between 0 and ${MAX_REVEALS}.`;
  }
  return null;
}

export function parseMini(text: string, level: MiniLevel = "easy"): ParseResult<MiniResult> {
  const clean = normalizeShareText(text);
  if (/Mini\s+Crossword\s*-\s*Unlimited/iu.test(clean)) {
    return { ok: false, error: "Unlimited puzzles don't count: play the daily one." };
  }
  const header = clean.match(HEADER);
  if (!header) return { ok: false, error: "Invalid format for Mini Crossword score." };
  if (header[1].toLowerCase() !== level) {
    const other = level === "easy" ? "Hard" : "Easy";
    return { ok: false, error: `That's the ${other} puzzle. Switch this card to ${other} and paste it there.` };
  }
  if (/archive\//iu.test(clean)) return { ok: false, error: "Archive puzzles don't count: play today's." };
  const puzzle = String(Number(header[2].replace(/\D/g, "")));

  const line = clean.slice((header.index ?? 0) + header[0].length).match(LINE);
  if (!line) return { ok: false, error: "Couldn't find your time. Paste the whole share text." };
  const seconds = line[3] !== undefined ? Number(line[3]) : Number(line[1]) * 60 + Number(line[2]);
  const reveals = line[4] !== undefined ? Number(line[4]) : 0;

  const result = { puzzle, seconds, reveals };
  const problem = checkMini(result);
  return problem ? { ok: false, error: problem } : { ok: true, result };
}

function miniAdapter(level: MiniLevel): GameAdapter<MiniResult> {
  const label = level === "easy" ? "Easy" : "Hard";
  return {
  id: level === "easy" ? "minicrossword" : "minicrosswordhard",
  name: `Mini Crossword (${label})`,
  url: level === "easy" ? "https://minicrossword.com/" : "https://minicrossword.com/hard",
  source: "minicrossword.com",
  color: "#8fcfbf",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: `Solve today's ${label} puzzle, click Share, then paste it here.`,
  parseShareText: (text) => parseMini(text, level),

  // Fewest reveals, then fastest.
  compare: (a, b) => a.reveals - b.reveals || a.seconds - b.seconds,
  canWin: () => true,
  // "1:23", "1:23 +2💡" with reveals.
  formatScore: (r) => (r.reveals ? `${formatTime(r.seconds)} +${r.reveals}💡` : formatTime(r.seconds)),
  averageLabel: "Avg time",
  average(results) {
    if (results.length === 0) return null;
    return formatTime(Math.round(results.reduce((sum, r) => sum + r.seconds, 0) / results.length));
  },
  };
}

export const mini = miniAdapter("easy");
export const miniHard = miniAdapter("hard");
