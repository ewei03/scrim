/**
 * A player's name in a table, on one line: on narrow screens a long name is
 * cut short with "…" (the full name shows on hover) instead of wrapping and
 * making the row taller. "(guest)" always stays visible after it.
 */
export function PlayerName({ name, guest }: { name: string; guest?: boolean }) {
  return (
    <span className="player-name" title={guest ? `${name} (guest)` : name}>
      <span className="player-name-text">{name}</span>
      {guest && <span className="guest-tag">(guest)</span>}
    </span>
  );
}
