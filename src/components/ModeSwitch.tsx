"use client";

/**
 * A small two-way (or more) switch between a game's modes, e.g. Costcodle's
 * Checkout and Classic: each mode is its own leaderboard. Used on the Today
 * card, in Rankings and in the archive.
 */
export function ModeSwitch({
  modes,
  value,
  onChange,
  label,
  tabs = false,
}: {
  /** Tabs across the full width (at the top of a Today card) instead of a small switch. */
  tabs?: boolean;
  modes: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  /** What the switch is for, for screen readers: "Costcodle mode". */
  label: string;
}) {
  return (
    <span className={`mode-switch${tabs ? " mode-tabs" : ""}`} role="group" aria-label={label}>
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          className="mode-switch-btn"
          aria-pressed={m.id === value}
          onClick={(e) => {
            // Inside a <summary> (the archive), so it doesn't open or close it too.
            e.preventDefault();
            e.stopPropagation();
            if (m.id !== value) onChange(m.id);
          }}
        >
          {m.label}
        </button>
      ))}
    </span>
  );
}
