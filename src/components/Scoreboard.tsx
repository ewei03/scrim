"use client";

import { rankEntries } from "@/games/ranking";
import { ResultDetail } from "@/games/ui";
import { ordinal } from "@/lib/time";
import type { GameAdapter } from "@/games/types";
import type { BoardRow } from "@/lib/types";

const SOURCE_ICON: Record<BoardRow["source"], { icon: string; title: string }> = {
  paste: { icon: "⎘", title: "Pasted share text" },
  extension: { icon: "⚡", title: "Captured automatically" },
};

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

      <table className="board">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th className="right">Score</th>
            <th className="hide-sm" />
            <th />
          </tr>
        </thead>
        <tbody>
          {ranked.map((r) => (
            <tr key={r.entry_id} className={r.winner ? "winner" : ""}>
              <td className="place">{r.winner ? "★" : ordinal(r.place)}</td>
              <td className="name">{r.display_name}</td>
              <td className="right score">{game.formatScore(r.result)}</td>
              <td className="hide-sm">
                <ResultDetail gameId={game.id} result={r.result} />
              </td>
              <td className="right nowrap">
                <span className="muted" title={SOURCE_ICON[r.source].title}>
                  {SOURCE_ICON[r.source].icon}
                </span>
                {canVoid && <VoidButton onClick={() => onVoid(r)} />}
              </td>
            </tr>
          ))}
          {hidden.map((r) => (
            <tr key={r.entry_id} className="hidden-row">
              <td className="place">?</td>
              <td className="name">{r.display_name}</td>
              <td className="right score" title="Submit your own result to see this">
                ▒▒▒
              </td>
              <td className="hide-sm muted small">locked in</td>
              <td className="right">{canVoid && <VoidButton onClick={() => onVoid(r)} />}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted center">
                Nobody has submitted yet{closed ? "" : " — be first"}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!closed && hidden.length > 0 && (
        <p className="muted small">Scores stay hidden until you submit yours. No peeking.</p>
      )}
    </section>
  );
}

function VoidButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="link-btn danger" title="Void this entry" onClick={onClick}>
      ×
    </button>
  );
}

function joinNames(names: string[]): string {
  const upper = names.map((n) => n.toUpperCase());
  if (upper.length <= 2) return upper.join(" & ");
  return `${upper.slice(0, -1).join(", ")} & ${upper.at(-1)}`;
}
