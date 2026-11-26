export type ParseResult<R> = { ok: true; result: R } | { ok: false; error: string };

/**
 * Everything Scrim needs to know about a supported game.
 *
 * Adding a game = writing one of these, adding a branch to
 * `normalize_result` / `is_supported_game` in the SQL schema, and registering
 * it in `registry.ts`.
 */
export interface GameAdapter<R = unknown> {
  id: string;
  name: string;
  url: string;
  /**
   * Tells games apart on crew pages (card bands and name tags). Text on it is
   * always dark, in both themes, so keep it mid-light; avoid the orange accent.
   */
  color: string;
  /** Who makes the game, credited where Scrim links to it. */
  source: string;
  /**
   * Scrim only supports games anyone can play for free. The literal `true`
   * type means a paywalled game can't be registered without a type error.
   */
  free: true;

  puzzleLabel(puzzleId: string): string;
  /** The puzzle for a calendar date [year, month (1-12), day]. */
  puzzleForDate(date: [number, number, number]): string;
  /**
   * Set for games with one worldwide puzzle that resets in a fixed time zone.
   * Other games follow each crew's time zone.
   */
  zone?: string;

  /** Whether the Scrim extension can capture results for this game. */
  autoSubmit: boolean;

  /** Short instruction shown above the paste box. */
  shareHint: string;
  parseShareText(text: string): ParseResult<R>;

  /** Negative if `a` ranks above `b`, positive if below, 0 for a tie. */
  compare(a: R, b: R): number;
  /** Whether this result is eligible to win (e.g. a failed Wordle can't). */
  canWin(r: R): boolean;
  formatScore(r: R): string;
  /** Headline average for the rankings table, e.g. average guesses. */
  average(results: R[]): string | null;
  averageLabel: string;
  /** True if a higher average is better (points, stars); otherwise lower is (guesses, time). */
  averageHigherIsBetter?: boolean;
}
