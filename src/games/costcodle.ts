import { normalizeShareText } from "./share";
import type { GameAdapter, ParseResult } from "./types";

/**
 * Costcodle Checkout (costcodle.com, the default mode): guess the price of
 * five Costco products, one guess each. The score is how far off the guesses
 * were in total, so lower is better. Classic mode isn't supported.
 */
export type CostcodleResult = {
  puzzle: string;
  /** How far off each of the five guesses was, in cents, in the order played. */
  offs: number[];
  /** The sum of `offs`, in cents. Worked out from them (here and on the server). */
  total: number;
};

export const ITEMS = 5;
/** Most a single guess can be off by, in cents ($10,000,000): keeps scores sane. */
export const MAX_OFF_CENTS = 1_000_000_000;

/**
 * Costcodle numbers its days from 2023-09-21 (as #2), by local date; Checkout
 * started on its day 1,148 and counts from #1 then, which makes Checkout #0
 * 2026-11-09. Resets at local midnight, like Wordle.
 */
const EPOCH_UTC = Date.UTC(2026, 10, 9);
const DAY_MS = 86_400_000;

export function costcodleNumberFor(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS);
}

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234 -> "$12.34", as Costcodle writes amounts. */
export function money(cents: number): string {
  return `$${usd.format(cents / 100)}`;
}

/** A short amount for the per-item chips: "$3.20", "$12", "$340", "$1.2k". */
export function shortMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars < 10) return `$${dollars.toFixed(2)}`;
  if (dollars < 1000) return `$${Math.round(dollars)}`;
  const k = dollars / 1000;
  if (k < 1000) return `$${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  const m = k / 1000;
  return `$${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`;
}

/** How close one guess was, for colouring its chip: within $2, within $10, further. */
export function closeness(cents: number): "near" | "mid" | "far" {
  return cents <= 200 ? "near" : cents <= 1000 ? "mid" : "far";
}

const HEADER = /Costcodle\s+Checkout\s*#\s*(\d[\d,]*)/iu;
// "1. Kirkland Signature Olive Oil — off $3.20". The name can be anything.
const ITEM = /^\s*([1-5])\.\s+.*?\s+[—–-]\s+off\s+\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/gimu;

function toCents(amount: string): number {
  return Math.round(Number(amount.replace(/,/g, "")) * 100);
}

/** What's wrong with a result, or null if it's a possible game. */
export function checkCostcodle(offs: number[]): string | null {
  if (offs.length !== ITEMS) return `A Checkout has ${ITEMS} items.`;
  if (offs.some((c) => !Number.isInteger(c) || c < 0 || c > MAX_OFF_CENTS)) {
    return "One of those amounts can't be right.";
  }
  return null;
}

export function costcodleResult(puzzle: string, offs: number[]): CostcodleResult {
  return { puzzle, offs, total: offs.reduce((s, c) => s + c, 0) };
}

export function parseCostcodle(text: string): ParseResult<CostcodleResult> {
  const clean = normalizeShareText(text);
  const header = clean.match(HEADER);
  if (!header) {
    if (/Costcodle\s+(?:Classic\s+)?#/iu.test(clean)) {
      return { ok: false, error: "That's Costcodle Classic. Play Checkout, the five-item game." };
    }
    return { ok: false, error: "Invalid format for Costcodle score." };
  }
  const puzzle = String(Number(header[1].replace(/\D/g, "")));

  const offs: number[] = [];
  for (const m of clean.slice((header.index ?? 0) + header[0].length).matchAll(ITEM)) {
    if (Number(m[1]) !== offs.length + 1) {
      return { ok: false, error: "The items should be numbered 1 to 5, in order." };
    }
    offs.push(toCents(m[2]));
  }
  if (offs.length === 0) {
    // Shared from the archive: just the total, no items.
    if (/total off/iu.test(clean)) {
      return { ok: false, error: "That share has no items in it. Share from today's game, not the archive." };
    }
    return { ok: false, error: "Couldn't find your items. Paste the whole share text." };
  }
  const problem = checkCostcodle(offs);
  return problem ? { ok: false, error: problem } : { ok: true, result: costcodleResult(puzzle, offs) };
}

export const costcodle: GameAdapter<CostcodleResult> = {
  id: "costcodle",
  name: "Costcodle",
  url: "https://costcodle.com/",
  source: "costcodle.com",
  color: "#e8908c",
  free: true,

  puzzleForDate: ([y, m, d]) => String(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)),
  puzzleLabel: (id) => `#${Number(id).toLocaleString("en-US")}`,
  autoSubmit: true,

  shareHint: "Finish today's Checkout, click Share, then paste it here.",
  parseShareText: parseCostcodle,

  // Least off in total wins.
  compare: (a, b) => a.total - b.total,
  canWin: () => true,
  formatScore: (r) => money(r.total),
  averageLabel: "Avg off",
  average(results) {
    if (results.length === 0) return null;
    return money(Math.round(results.reduce((sum, r) => sum + r.total, 0) / results.length));
  },
};
