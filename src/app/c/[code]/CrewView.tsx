"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CopyLink } from "@/components/CopyLink";
import { NewLobbyForm } from "@/components/NewLobbyForm";
import { HeadToHeadGrid, Rankings } from "@/components/Rankings";
import { Loading, RequireAuth } from "@/components/RequireAuth";
import { rankEntries } from "@/games/ranking";
import { GAMES, getGame } from "@/games/registry";
import { useAuth } from "@/lib/auth";
import { crewStats } from "@/lib/stats";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { formatDay, timeLeft } from "@/lib/time";
import { endedAt, isClosed, type Crew, type Lobby } from "@/lib/types";

type Member = { user_id: string; profiles: { display_name: string } };
type LobbyWithEntries = Lobby & { entries: { user_id: string; result: unknown }[] };

export function CrewView() {
  return (
    <RequireAuth title="You've been invited to a crew">
      <CrewPage />
    </RequireAuth>
  );
}

/** Opening a crew link joins the crew, so this doubles as the invite handler. */
async function fetchCrew(code: string) {
  const crew = await rpc<Crew>("join_crew", { p_code: code });
  const sb = supabase();
  const [m, l] = await Promise.all([
    sb.from("crew_members").select("user_id, profiles(display_name)").eq("crew_id", crew.id).order("joined_at"),
    sb.from("lobbies").select("*, entries(user_id, result)").eq("crew_id", crew.id).order("created_at", { ascending: false }),
  ]);
  if (m.error || l.error) throw m.error ?? l.error;
  return { crew, members: m.data as unknown as Member[], lobbies: l.data as LobbyWithEntries[] };
}

function CrewPage() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const [crew, setCrew] = useState<Crew | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [lobbies, setLobbies] = useState<LobbyWithEntries[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCrew(code).then(
      (d) => {
        if (cancelled) return;
        setCrew(d.crew);
        setMembers(d.members);
        setLobbies(d.lobbies);
      },
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.profiles.display_name])), [members]);
  const open = lobbies.filter((l) => !isClosed(l));
  const closed = lobbies.filter((l) => isClosed(l));

  const statsByGame = useMemo(() => {
    const memberIds = members.map((m) => m.user_id);
    return Object.values(GAMES)
      .map((game) => {
        const played = lobbies
          .filter((l) => l.game === game.id && isClosed(l))
          .map((l) => ({ ...l, ended_at: endedAt(l) }));
        return { game, count: played.length, ...crewStats(game, played, memberIds) };
      })
      .filter((s) => s.count > 0);
  }, [lobbies, members]);

  if (error) return <p className="error">{error}</p>;
  if (!crew) return <Loading />;

  return (
    <div className="stack-lg">
      <section className="stack">
        <p className="eyebrow">Crew · {members.length} {members.length === 1 ? "member" : "members"}</p>
        <div className="row between wrap">
          <h1>{crew.name}</h1>
          <CopyLink path={`/c/${crew.invite_code}`} label="Invite to crew" />
        </div>
        <p className="muted small">{members.map((m) => m.profiles.display_name).join(" · ")}</p>
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Open lobbies</h2>
          <button className="btn btn-small" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New lobby"}
          </button>
        </div>
        {showForm && <NewLobbyForm crewId={crew.id} />}
        {open.length === 0 ? (
          !showForm && <p className="muted">No open lobbies. Start today&apos;s.</p>
        ) : (
          <ul className="list">
            {open.map((l) => {
              const game = getGame(l.game);
              const done = l.entries.some((e) => e.user_id === user?.id);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className="list-row">
                    <strong>
                      {game.name} {game.puzzleLabel(l.puzzle_id)}
                    </strong>
                    <span className="row">
                      <span className="muted small">{timeLeft(l.closes_at)} left</span>
                      {done ? <span className="pill">✓ in</span> : <span className="pill pill-hot">play</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {statsByGame.map(({ game, players, h2h, count }) => (
        <section key={game.id} className="stack">
          <h2>
            {game.name} rankings <span className="muted small">· {count} played</span>
          </h2>
          <Rankings game={game} players={players} names={names} />
          <h3>Head to head</h3>
          <HeadToHeadGrid players={players} names={names} h2h={h2h} />
        </section>
      ))}

      <section className="stack">
        <h2>Archive</h2>
        {closed.length === 0 ? (
          <p className="muted">Finished lobbies will show up here.</p>
        ) : (
          <ul className="list">
            {closed.map((l) => {
              const game = getGame(l.game);
              const winners = rankEntries(game, l.entries).filter((e) => e.winner);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className="list-row">
                    <span>
                      <strong>
                        {game.name} {game.puzzleLabel(l.puzzle_id)}
                      </strong>{" "}
                      <span className="muted small">· {formatDay(endedAt(l))}</span>
                    </span>
                    <span className="small">
                      {winners.length
                        ? `★ ${winners.map((w) => names.get(w.user_id) ?? "?").join(", ")} · ${game.formatScore(winners[0].result)}`
                        : l.entries.length
                          ? "no winner"
                          : "no entries"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
