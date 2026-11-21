/**
 * The "opens elsewhere" arrow after a link or button's text (Play Wordle,
 * Add to Chrome…). Drawn, not the ↗ character, which some systems show as a
 * colour emoji. Takes the text's colour and size.
 */
export function ExternalArrow() {
  return (
    <svg className="external-arrow" viewBox="0 0 12 12" aria-hidden focusable="false">
      <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}
