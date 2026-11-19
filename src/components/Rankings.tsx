import Link from "next/link";
import type { GameAdapter } from "@/games/types";
import { h2hKey, type HeadToHead, type PlayerStats } from "@/lib/stats";

export function Rankings({
  game,
  players,
  names,
}: {
  game: GameAdapter<unknown>;
  players: PlayerStats[];
  names: Map<string, string>;
}) {
  return (
    <div className="table-wrap">
      <table className="board">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th className="right" title="Wins">W</th>
            <th className="right" title="Games played">GP</th>
            <th className="right">Win%</th>
            <th className="right">{game.averageLabel}</th>
            <th className="right hide-sm" title="Current win streak">Strk</th>
            <th className="hide-sm">Form</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.userId}>
              <td className="place">{p.played ? sharedRank(players, p) : "–"}</td>
              <td className="name">{names.get(p.userId) ?? "?"}</td>
              <td className="right score">{p.wins}</td>
              <td className="right">{p.played}</td>
              <td className="right">{p.played ? `${Math.round(p.winRate * 100)}%` : "–"}</td>
              <td className="right">{p.average ?? "–"}</td>
              <td className="right hide-sm">{p.streak ? `${p.streak}W` : "–"}</td>
              <td className="hide-sm">
                <span className="form">
                  {p.recent.map((r) => (
                    <Link
                      key={r.lobbyId}
                      href={`/l/${r.inviteCode}`}
                      className={`form-chip ${r.winner ? "win" : ""}`}
                      title={`${game.name} ${game.puzzleLabel(r.puzzleId)}: ${r.score}`}
                    >
                      {r.winner ? "W" : r.place}
                    </Link>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeadToHeadGrid({
  players,
  names,
  h2h,
}: {
  players: PlayerStats[];
  names: Map<string, string>;
  h2h: Map<string, HeadToHead>;
}) {
  const active = players.filter((p) => p.played > 0);
  if (active.length < 2) return <p className="muted">Head-to-head records appear after two people play the same lobby.</p>;
  return (
    <div className="table-wrap">
      <table className="board h2h">
        <thead>
          <tr>
            <th className="muted small">row vs col</th>
            {active.map((p) => (
              <th key={p.userId} className="center">
                {initials(names.get(p.userId))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((a) => (
            <tr key={a.userId}>
              <td className="name">{names.get(a.userId)}</td>
              {active.map((b) => {
                if (a.userId === b.userId) return <td key={b.userId} className="center muted">·</td>;
                const r = h2h.get(h2hKey(a.userId, b.userId));
                if (!r) return <td key={b.userId} className="center muted">–</td>;
                const cls = r.wins > r.losses ? "up" : r.wins < r.losses ? "down" : "";
                return (
                  <td key={b.userId} className={`center ${cls}`} title="wins-losses-ties">
                    {r.wins}-{r.losses}
                    {r.ties ? `-${r.ties}` : ""}
                  </td>
                );
              })}
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

function initials(name = "?") {
  return name.slice(0, 3).toUpperCase();
}
