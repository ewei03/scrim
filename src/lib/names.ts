/**
 * Display names and crew names: any characters except emoji, with single
 * spaces between words. The database enforces the same rule (0045); these keep
 * the inputs from ever holding anything it would refuse.
 * Lengths count code points, like Postgres `char_length`.
 */

export const MAX_DISPLAY_NAME = 16;
export const MAX_CREW_NAME = 24;

/**
 * Emoji, as the database defines them (keep in sync with 0045): the emoji
 * blocks, misc symbols and dingbats, the emoji in U+2300 and U+2B00, the
 * emoji presentation selector, the keycap mark and tag characters. Matched
 * with any zero-width joiners chaining one to the next (👨‍👩‍👧), so none are
 * left behind.
 */
const E =
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{231A}\\u{231B}\\u{23E9}-\\u{23FA}\\u{2B05}-\\u{2B07}\\u{2B1B}\\u{2B1C}\\u{2B50}\\u{2B55}\\u{FE0F}\\u{20E3}\\u{E0020}-\\u{E007F}]";
const EMOJI = new RegExp(`${E}(?:\\u200D${E}?)*`, "gu");

/** For an input's onChange: drops emoji and doubled or leading spaces as they're typed. */
export function typedName(value: string): string {
  return value.replace(EMOJI, "").replace(/ {2,}/g, " ").replace(/^ /, "");
}

/** The name as it's saved: no emoji, trimmed, cut to `max` characters. */
export function cleanName(value: string, max: number): string {
  return Array.from(typedName(value)).slice(0, max).join("").trim();
}
