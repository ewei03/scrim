"use client";

import { rankEntries } from "@/games/ranking";
import { ResultDetail } from "@/games/ui";
import { PlayerName } from "./PlayerName";
import { toggleClock, useClock24h } from "@/lib/clock";
import { formatTime, ordinal } from "@/lib/time";
import type { GameAdapter } from "@/games/types";
import type { BoardRow } from "@/lib/types";

export function Scoreboard({
  game,
  rows,
  closed,
  canVoid,
  onVoid,
}: {
  game: GameAdapter<unknown>;
  rows: BoardRow[];
  closed: boolean;
  /** The crew owner can void entries. */
  canVoid: boolean;
  onVoid: (row: BoardRow) => void;
}) {
  const ranked = rankEntries(
    game,
    rows.filter((r) => !r.hidden).map((r) => ({ ...r, result: r.result })),
  );
  const hidden = rows.filter((r) => r.hidden);
  // Your 12/24-hour choice, shared by every scoreboard (click the heading to flip it).
  const clock24h = useClock24h();
  const winners = ranked.filter((r) => r.winner);

  return (
    <section className="stack">
      {closed && (
        <div className="banner">
          {rows.length === 0
            ? "NO ENTRIES"
            : winners.length === 0
              ? "NO WINNER TODAY"
              : `★ ${joinNames(winners.map((w) => w.display_name))} ${winners.length > 1 ? "WIN" : "WINS"} ★`}
        </div>
      )}

      {/* On phones the table can be wider than the screen (the Result column):
          it scrolls sideways rather than dropping a column. */}
      <div className="table-wrap">
        <table className="board scoreboard">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Score</th>
              <th>Result</th>
              <th>
                <button
                  type="button"
                  className="th-toggle"
                  onClick={toggleClock}
                  title={clock24h ? "Switch to 12-hour time" : "Switch to 24-hour time"}
                  aria-label={`Time, ${clock24h ? "24" : "12"}-hour. Switch to ${clock24h ? "12" : "24"}-hour`}
                >
                  Time
                </button>
              </th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.entry_id} className={r.winner ? "winner" : ""}>
                <td
                  className={r.place <= 3 ? `place place-${r.place}` : "place"}
                >
                  {ordinal(r.place)}
                </td>
                <td className="name">
                  <PlayerName name={r.display_name} guest={r.is_guest} />
                </td>
                <td className="score">{game.formatScore(r.result)}</td>
                <td className="result">
                  <ResultDetail gameId={game.id} result={r.result} />
                </td>
                <td className="time muted small">
                  <time dateTime={r.submitted_at}>{formatTime(r.submitted_at, clock24h)}</time>
                </td>
                <td className="right nowrap">
                  {canVoid && <VoidButton onClick={() => onVoid(r)} />}
                </td>
              </tr>
            ))}
            {hidden.map((r) => (
              <tr key={r.entry_id} className="hidden-row">
                <td className="place">?</td>
                <td className="name">
                  <PlayerName name={r.display_name} guest={r.is_guest} />
                </td>
                <td className="score">
                  <span
                    className="pill hidden-pill"
                    title="Submit your own result to see this"
                  >
                    Hidden
                  </span>
                </td>
                <td className="result muted small">Submit yours to see</td>
                <td className="time muted small">
                  <time dateTime={r.submitted_at}>{formatTime(r.submitted_at, clock24h)}</time>
                </td>
                <td className="right">
                  {canVoid && <VoidButton onClick={() => onVoid(r)} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  Nobody has submitted yet{closed ? "" : " - be the first"}!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!closed && hidden.length > 0 && (
        <p className="muted small">
          Scores are hidden until you submit yours. No peeking!
        </p>
      )}
    </section>
  );
}

function VoidButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="link-btn danger"
      title="Void this entry"
      onClick={onClick}
    >
      ×
    </button>
  );
}

function joinNames(names: string[]): string {
  const upper = names.map((n) => n.toUpperCase());
  if (upper.length <= 2) return upper.join(" & ");
  return `${upper.slice(0, -1).join(", ")} & ${upper.at(-1)}`;
}
