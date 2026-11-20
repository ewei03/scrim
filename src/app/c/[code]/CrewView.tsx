"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CopyLink } from "@/components/CopyLink";
import { NewLobbyForm } from "@/components/NewLobbyForm";
import { Rankings } from "@/components/Rankings";
import { Modal } from "@/components/Modal";
import { Loading, RequireAuth } from "@/components/RequireAuth";
import { rankEntries } from "@/games/ranking";
import { GAMES, getGame } from "@/games/registry";
import { useAuth } from "@/lib/auth";
import { crewStats } from "@/lib/stats";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { formatDay, timeLeft } from "@/lib/time";
import { endedAt, isClosed, type Crew, type Lobby } from "@/lib/types";

type Member = { user_id: string; profiles: { display_name: string } };
type LobbyWithEntries = Lobby & {
  entries: { user_id: string; result: unknown; profiles: { display_name: string } | null }[];
};

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
    sb.from("lobbies").select("*, entries(user_id, result, profiles(display_name))").eq("crew_id", crew.id).order("created_at", { ascending: false }),
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
  const [showManage, setShowManage] = useState(false);
  const [rankingsGame, setRankingsGame] = useState<string | null>(null);
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

  // Members first, then anyone who has left but still appears in the archive.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lobbies) for (const e of l.entries) if (e.profiles) map.set(e.user_id, e.profiles.display_name);
    for (const m of members) map.set(m.user_id, m.profiles.display_name);
    return map;
  }, [lobbies, members]);
  const open = lobbies.filter((l) => !isClosed(l));
  // Lobbies nobody played aren't worth keeping in the archive.
  const closed = lobbies.filter((l) => isClosed(l) && l.entries.length > 0);

  const statsByGame = useMemo(() => {
    const memberIds = members.map((m) => m.user_id);
    return Object.values(GAMES)
      .map((game) => {
        const played = lobbies
          .filter((l) => l.game === game.id && isClosed(l) && l.entries.length > 0)
          .map((l) => ({ ...l, ended_at: endedAt(l) }));
        return { game, count: played.length, ...crewStats(game, played, memberIds) };
      })
      .filter((s) => s.count > 0);
  }, [lobbies, members]);

  if (error) return <p className="error">{error}</p>;
  if (!crew) return <Loading />;

  const isOwner = crew.created_by === user?.id;
  // Games with finished lobbies; defaults to the first until one is picked.
  const ranked = statsByGame.find((s) => s.game.id === rankingsGame) ?? statsByGame[0];

  function memberRemoved(userId: string) {
    setMembers((ms) => ms.filter((m) => m.user_id !== userId));
    // The server also drops their entries in open lobbies.
    setLobbies((ls) =>
      ls.map((l) => (isClosed(l) ? l : { ...l, entries: l.entries.filter((e) => e.user_id !== userId) })),
    );
  }

  return (
    <div className="stack-lg">
      <section className="crew-plate">
        <p className="crew-plate-bar">
          <span>Crew</span>
          <span>
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </p>
        <div className="crew-plate-body">
          <div className="row between wrap">
            <h1>{crew.name}</h1>
            <div className="row">
              <CopyLink path={`/c/${crew.invite_code}`} label="Invite to crew" />
              {isOwner && (
                <button
                  className="icon-btn"
                  aria-label="Manage crew"
                  aria-haspopup="dialog"
                  title="Manage crew"
                  onClick={() => setShowManage(true)}
                >
                  ⚙
                </button>
              )}
            </div>
          </div>
          <ul className="member-chips">
            {members.map((m) => (
              <li key={m.user_id} className={m.user_id === user?.id ? "me" : undefined}>
                {m.profiles.display_name}
              </li>
            ))}
          </ul>
        </div>
        {isOwner && (
          <Modal open={showManage} onClose={() => setShowManage(false)} title="Manage crew">
            <ManageCrew crew={crew} members={members} onRemoved={memberRemoved} />
          </Modal>
        )}
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
          <ul className="list list-live">
            {open.map((l) => {
              const game = getGame(l.game);
              const done = l.entries.some((e) => e.user_id === user?.id);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className={`list-row ${done ? "" : "todo"}`}>
                    <strong>
                      <span className="live-dot" aria-hidden>●</span>
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

      {ranked && (
        <section className="stack">
          <div className="row between wrap">
            <h2>
              Rankings <span className="muted small">· {ranked.count} played</span>
            </h2>
            <select
              className="input rankings-game"
              aria-label="Game"
              value={ranked.game.id}
              onChange={(e) => setRankingsGame(e.target.value)}
            >
              {statsByGame.map(({ game }) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </div>
          <div className="stack">
            <Rankings game={ranked.game} players={ranked.players} names={names} />
          </div>
        </section>
      )}

      <section className="stack">
        <h2>Archive</h2>
        {closed.length === 0 ? (
          <p className="muted">Finished lobbies will show up here.</p>
        ) : (
          <ul className="list list-archive">
            {closed.map((l) => {
              const game = getGame(l.game);
              const winners = rankEntries(game, l.entries).filter((e) => e.winner);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className="list-row">
                    <span className="archive-date">{formatDay(endedAt(l))}</span>
                    <span>
                      {game.name} {game.puzzleLabel(l.puzzle_id)}
                    </span>
                    <span>
                      {winners.length
                        ? `★ ${winners.map((w) => names.get(w.user_id) ?? "?").join(", ")} · ${game.formatScore(winners[0].result)}`
                        : "no winner"}
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

function ManageCrew({
  crew,
  members,
  onRemoved,
}: {
  crew: Crew;
  members: Member[];
  onRemoved: (userId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = members.filter((m) => m.user_id !== crew.created_by);

  async function remove(m: Member) {
    const name = m.profiles.display_name;
    if (!confirm(`Remove ${name} from ${crew.name}? Their entries in open lobbies are deleted, and they can't rejoin with the invite link.`)) return;
    setBusy(m.user_id);
    setError(null);
    try {
      await rpc("remove_crew_member", { p_crew: crew.id, p_user: m.user_id });
      onRemoved(m.user_id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteCrew() {
    if (!confirm(`Delete ${crew.name} for everyone? All its lobbies, results and rankings are deleted. This can't be undone.`)) return;
    setBusy("crew");
    setError(null);
    try {
      await rpc("delete_crew", { p_crew: crew.id });
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <>
      <h3>Members</h3>
      {others.length === 0 ? (
        <p className="muted small">No other members yet.</p>
      ) : (
        <ul className="manage-members">
          {others.map((m) => (
            <li key={m.user_id}>
              <span>{m.profiles.display_name}</span>
              <button className="link-btn danger" disabled={busy !== null} onClick={() => remove(m)}>
                {busy === m.user_id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row between wrap danger-zone">
        <span className="muted small">Deletes all lobbies, results and rankings for everyone.</span>
        <button className="btn btn-small btn-danger" disabled={busy !== null} onClick={deleteCrew}>
          {busy === "crew" ? "Deleting…" : "Delete crew"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </>
  );
}
