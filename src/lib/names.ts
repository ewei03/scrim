/**
 * Display names and crew names: ASCII letters and digits, with single spaces
 * between words. The database enforces the same rule (0043); these keep the
 * inputs from ever holding anything it would refuse.
 */

export const MAX_DISPLAY_NAME = 16;
export const MAX_CREW_NAME = 24;

/** For an input's onChange: drops other characters and doubled or leading spaces as they're typed. */
export function typedName(value: string): string {
  return value.replace(/[^A-Za-z0-9 ]/g, "").replace(/ {2,}/g, " ").replace(/^ /, "");
}

/** The name as it's saved: allowed characters only, trimmed, cut to `max`. */
export function cleanName(value: string, max: number): string {
  return typedName(value).slice(0, max).trim();
}
