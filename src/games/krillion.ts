import { dateIn } from "@/lib/time";
import type { GameAdapter, ParseResult } from "./types";

export type KrillionResult = {
  puzzle: string;
  /** 0–700: the sum of the seven answers' rarity points. 1 point = 10 m of depth. */
  points: number;
  /** One letter per prompt, see TIERS. */
  tiers?: string;
};

/** Krillion #1 was the dive of 2026-07-16 (New York date). */
const EPOCH_UTC = Date.UTC(2026, 6, 15);
const DAY_MS = 86_400_000;
const ZONE = "America/New_York";
export const PROMPTS = 7;

/** Krillion has one dive worldwide that resets at midnight New York time. */
export function krillionNumberFor(date: Date): number {
  const [y, m, d] = dateIn(ZONE, date);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

/** Rarity tiers in the share grid. Keep in sync with normalize_result in SQL. */
export const TIERS: Record<string, { emoji: string; name: string; points: number }> = {
  x: { emoji: "⬛", name: "Miss", points: 0 },
  p: { emoji: "🫧", name: "Plankton", points: 10 },
  c: { emoji: "🤡", name: "Too Clever", points: 15 },
  s: { emoji: "🐟", name: "Schooler", points: 30 },
  r: { emoji: "🦑", name: "Rare", points: 60 },
  d: { emoji: "🏮", name: "Deep Cut", points: 85 },
  k: { emoji: "🌟", name: "One in a Krillion", points: 100 },
};

const BY_EMOJI = new Map(Object.entries(TIERS).map(([code, t]) => [t.emoji, code]));
BY_EMOJI.set("⬜", "x");

const HEADER = /Krillion\s*#\s*(\d[\d,]*)/iu;

export function tierPoints(tiers: string): number {
  return Array.from(tiers).reduce((sum, c) => sum + (TIERS[c]?.points ?? 0), 0);
}

export function parseKrillion(text: string): ParseResult<KrillionResult> {
  const clean = text.replace(/️/g, "");
  const header = clean.match(HEADER);
  if (!header) {
    if (/Krillion\s*∞/u.test(clean)) return { ok: false, error: "That's an Unlimited dive. Paste today's Daily Dive." };
    return { ok: false, error: "Couldn't find a Krillion result. It should start like “Krillion #127 🦐”." };
  }
  const puzzle = String(Number(header[1].replace(/\D/g, "")));

  // The score line's wording may vary, so the score is worked out from the tiers.
  const tiers = Array.from(clean.slice((header.index ?? 0) + header[0].length))
    .map((c) => BY_EMOJI.get(c))
    .filter(Boolean)
    .join("");
  if (tiers.length !== PROMPTS) {
    return {
      ok: false,
      error: tiers.length
        ? `Found ${tiers.length} answers but a dive has ${PROMPTS}. Paste the whole share text.`
        : "Couldn't find your answers. Paste the whole share text.",
    };
  }
  return { ok: true, result: { puzzle, points: tierPoints(tiers), tiers } };
}

export function manualKrillion(puzzle: string, points: number): KrillionResult {
  return { puzzle, points };
}

export const krillion: GameAdapter<KrillionResult> = {
  id: "krillion",
  name: "Krillion",
  url: "https://krillion.io/",
  source: "krillion.io",
  color: "#4ea8cc",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  zone: ZONE,
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish the Daily Dive, copy your result, then paste it here.",
  sharePlaceholder: "Krillion #127 🦐\n…\n🐟🫧🦑⬛🌟🐟🏮",
  parseShareText: parseKrillion,

  compare: (a, b) => b.points - a.points,
  canWin: (r) => r.points > 0,
  formatScore: (r) => r.points.toLocaleString("en-US"),
  averageLabel: "Avg score",
  average(results) {
    if (results.length === 0) return null;
    const avg = results.reduce((sum, r) => sum + r.points, 0) / results.length;
    return Math.round(avg).toLocaleString("en-US");
  },
};
