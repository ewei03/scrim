/**
 * A settings gear. Drawn, not the ⚙ character, which some systems show as a
 * colour emoji. Takes the text's colour.
 */
export function GearIcon() {
  return (
    <svg className="gear-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      {/* Eight rounded teeth, one every 45°. */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <rect
          key={angle}
          x="10"
          y="1.25"
          width="4"
          height="5.5"
          rx="1.6"
          fill="currentColor"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      {/* The body, with a hole in the middle. */}
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="3.5" />
    </svg>
  );
}
