import type { GameAdapter } from "@/games/types";
import type { PlayerStats } from "@/lib/stats";
import { PlayerName } from "./PlayerName";

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
  return (
    <div className="table-wrap">
      <table className="board">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th className="right">Wins</th>
            <th className="right" title="Games played">
              Played
            </th>
            <th className="right">Win rate</th>
            <th className="right">{game.averageLabel}</th>
            <th
              className="right hide-sm"
              title="Longest win streak (🔥 = still going)"
            >
              Best streak
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
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
