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
  blurb: string;
  /**
   * Scrim only supports games anyone can play for free. The literal `true`
   * type means a paywalled game can't be registered without a type error.
   */
  free: true;

  /** The puzzle that is live for the player right now (in their timezone). */
  currentPuzzleId(now?: Date): string;
  puzzleLabel(puzzleId: string): string;

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
}
