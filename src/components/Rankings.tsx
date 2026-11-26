"use client";

import { useState } from "react";
import type { GameAdapter } from "@/games/types";
import type { PlayerStats } from "@/lib/stats";
import { PlayerName } from "./PlayerName";

type SortKey = "wins" | "played" | "winRate" | "average" | "streak";
type Sort = SortKey | null;

/** How good a player is on a column (higher is better), or null if they have none (always listed last). */
function sortValue(p: PlayerStats, key: SortKey, game: GameAdapter<unknown>): number | null {
  if (!p.played) return null;
  switch (key) {
    case "wins":
      return p.wins;
    case "played":
      return p.played;
    case "winRate":
      return p.winRate;
    case "average": {
      const avg = p.average === null ? null : parseAverage(p.average);
      return avg === null ? null : game.averageHigherIsBetter ? avg : -avg;
    }
    case "streak":
      // Longest streak, then a live one ahead of one that's over.
      return p.maxStreak + (p.streak === p.maxStreak && p.maxStreak > 0 ? 0.5 : 0);
  }
}

/** Reads an average as shown ("3.50", "$5.01", "1,234", "1:57", "1:04:05", "45s") into a number. */
export function parseAverage(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "").replace(/s$/i, "");
  const parts = clean.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function sorted(players: PlayerStats[], sort: Sort, game: GameAdapter<unknown>) {
  if (!sort) return players;
  const order = new Map(players.map((p, i) => [p.userId, i]));
  return [...players].sort((a, b) => {
    const va = sortValue(a, sort, game);
    const vb = sortValue(b, sort, game);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) {
      return vb - va;
    }
    return order.get(a.userId)! - order.get(b.userId)!;
  });
}

export function Rankings({
  game,
  players,
  names,
  guests,
}: {
  game: GameAdapter<unknown>;
  players: PlayerStats[];
  names: Map<string, string>;
  /** Marked "(guest)" after their name. */
  guests: Set<string>;
}) {
  // No sort picked: the crew's ranking order. Clicking a column sorts by it, best first.
  const [sort, setSort] = useState<Sort>(null);
  const shown = sorted(players, sort, game);

  function header(key: SortKey, label: string, title?: string, extra = "") {
    const on = sort === key;
    return (
      <th
        className={`right sortable ${extra}`}
        title={title}
        aria-sort={on ? "other" : "none"}
      >
        <button
          type="button"
          className="sort-btn"
          onClick={() => setSort(key)}
        >
          {label}
        </button>
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table className="board">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            {header("wins", "Wins")}
            {header("played", "Played", "Games played")}
            {header("winRate", "Win rate")}
            {header("average", game.averageLabel)}
            {header("streak", "Best streak", "Longest win streak (🔥 = still going)", "hide-sm")}
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const rank = p.played ? sharedRank(players, p) : null;
            const first = rank === 1;
            return (
              <tr key={p.userId} className={first ? "winner" : ""}>
                <td className={first ? "rank-1" : ""}>{rank ?? "–"}</td>
                <td>
                  <PlayerName
                    name={names.get(p.userId) ?? "?"}
                    guest={guests.has(p.userId)}
                  />
                </td>
                <td className="right">{p.wins}</td>
                <td className="right">{p.played}</td>
                <td className="right">
                  {p.played ? `${Math.round(p.winRate * 100)}%` : "–"}
                </td>
                <td className="right">{p.average ?? "–"}</td>
                <td className="right hide-sm">
                  <StreakCell stats={p} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A player's place: players with identical records share a rank. */
export function sharedRank(players: PlayerStats[], p: PlayerStats) {
  return (
    1 +
    players.findIndex(
      (o) =>
        o.wins === p.wins && o.winRate === p.winRate && o.played === p.played,
    )
  );
}

/** Longest win streak, lit up while it's still going. */
export function StreakCell({ stats }: { stats: PlayerStats }) {
  if (!stats.maxStreak) return <>–</>;
  if (stats.streak === stats.maxStreak) {
    return (
      <span className="streak-live" title="Longest streak, still going">
        {stats.maxStreak}W<span className="streak-fire" aria-hidden="true">🔥</span>
      </span>
    );
  }
  return (
    <span title={stats.streak ? `Current streak: ${stats.streak}W` : undefined}>
      {stats.maxStreak}W
    </span>
  );
}
