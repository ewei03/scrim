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
            <th className="right" title="Games played">Played</th>
            <th className="right">Win rate</th>
            <th className="right">{game.averageLabel}</th>
            <th className="right hide-sm" title="Current win streak">Streak</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.userId}>
              <td className="place">{p.played ? sharedRank(players, p) : "–"}</td>
              <td className="name">
                <PlayerName name={names.get(p.userId) ?? "?"} guest={guests.has(p.userId)} />
              </td>
              <td className="right score">{p.wins}</td>
              <td className="right">{p.played}</td>
              <td className="right">{p.played ? `${Math.round(p.winRate * 100)}%` : "–"}</td>
              <td className="right">{p.average ?? "–"}</td>
              <td className="right hide-sm">{p.streak ? `${p.streak}W` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Players with identical records share a rank. */
function sharedRank(players: PlayerStats[], p: PlayerStats) {
  return 1 + players.findIndex((o) => o.wins === p.wins && o.winRate === p.winRate && o.played === p.played);
}
