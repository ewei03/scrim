"use client";

import { useMemo } from "react";
import type { GameAdapter } from "@/games/types";
import { crewStats, type StatRound } from "@/lib/stats";
import { ordinal } from "@/lib/time";
import { Modal } from "./Modal";
import { sharedRank } from "./Rankings";

export type MemberInfo = {
  userId: string;
  name: string;
  isGuest: boolean;
  isOwner: boolean;
  /** When they joined the crew. */
  joinedAt: string;
};

type GameRound = StatRound<unknown> & { game: string };

/**
 * One member's card, opened from their name in the crew box: when they joined,
 * and their record in each game the crew has finished days of (all time, the
 * same numbers as Rankings). Removing someone is in Manage crew, not here.
 */
export function MemberStats({
  member,
  games,
  rounds,
  rankedIds,
  byWinRate,
  onClose,
}: {
  member: MemberInfo | null;
  /** The crew's games that anyone has finished a day of. */
  games: GameAdapter<unknown>[];
  /** Finished days, every game. */
  rounds: GameRound[];
  /** Everyone in the rankings (current members), for their place. */
  rankedIds: string[];
  /** The crew's ranking rule. */
  byWinRate: boolean;
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    if (!member) return [];
    return games.flatMap((game) => {
      const played = rounds.filter((r) => r.game === game.id);
      const ids = rankedIds.includes(member.userId) ? rankedIds : [...rankedIds, member.userId];
      const { players } = crewStats(game, played, ids, { byWinRate });
      const me = players.find((p) => p.userId === member.userId);
      if (!me || me.played === 0) return [];
      return [{ game, stats: me, place: sharedRank(players, me), of: players.filter((p) => p.played > 0).length }];
    });
  }, [member, games, rounds, rankedIds, byWinRate]);

  return (
    <Modal open={member !== null} onClose={onClose} title={member?.name ?? "Player"} size="large">
      {member && (
        <div className="stack member-stats">
          <p className="muted small">
            {member.isOwner ? "Owner · " : ""}
            {member.isGuest ? "Guest · " : ""}
            Joined{" "}
            {new Date(member.joinedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>

          {rows.length === 0 ? (
            <p className="muted">No stats to show yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="board member-stats-table">
                <thead>
                  <tr>
                    <th>Game</th>
                    <th className="right">Rank</th>
                    <th className="right">Played</th>
                    <th className="right">Wins</th>
                    <th className="right">Win rate</th>
                    <th className="right">Avg</th>
                    <th className="right">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ game, stats, place, of }) => (
                    <tr key={game.id}>
                      <td className="nowrap">{game.name}</td>
                      <td className="right nowrap" title={`${ordinal(place)} of ${of} in ${game.name}`}>
                        {ordinal(place)}
                      </td>
                      <td className="right">{stats.played}</td>
                      <td className="right">{stats.wins}</td>
                      <td className="right">{Math.round(stats.winRate * 100)}%</td>
                      <td className="right nowrap" title={game.averageLabel}>
                        {stats.average ?? "–"}
                      </td>
                      <td className="right">{stats.streak ? `${stats.streak}W` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
