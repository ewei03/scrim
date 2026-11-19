import type { GameAdapter } from "./types";

export type Ranked<T> = T & { place: number; winner: boolean };

/**
 * Sort entries best-first. Tied results share a place, and every entry in
 * first place that is eligible to win is a winner — two people who both get
 * Wordle in one both win.
 */
export function rankEntries<R, T extends { result: R }>(game: GameAdapter<R>, entries: T[]): Ranked<T>[] {
  const sorted = [...entries].sort((a, b) => game.compare(a.result, b.result));
  return sorted.map((entry) => {
    const place = 1 + sorted.filter((other) => game.compare(other.result, entry.result) < 0).length;
    return { ...entry, place, winner: place === 1 && game.canWin(entry.result) };
  });
}
