"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CopyLink } from "@/components/CopyLink";
import { Loading, RequireAuth } from "@/components/RequireAuth";
import { Scoreboard } from "@/components/Scoreboard";
import { SubmitPanel } from "@/components/SubmitPanel";
import { getGame } from "@/games/registry";
import { useAuth } from "@/lib/auth";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { formatDay, timeLeft } from "@/lib/time";
import { endedAt, isClosed, type BoardRow, type Lobby } from "@/lib/types";

const POLL_MS = 10_000;

export function LobbyView() {
  return (
    <RequireAuth title="You've been challenged">
      <LobbyPage />
    </RequireAuth>
  );
}

function fetchBoard(lobbyId: string) {
  return rpc<BoardRow[]>("get_lobby_board", { p_lobby: lobbyId });
}

/** Opening a lobby link joins its crew, so this doubles as the invite handler. */
async function fetchLobby(code: string) {
  const lobby = await rpc<Lobby>("join_lobby", { p_code: code });
  const [crew, board] = await Promise.all([
    supabase().from("crews").select("name, invite_code").eq("id", lobby.crew_id).single(),
    fetchBoard(lobby.id),
  ]);
  if (crew.error) throw crew.error;
  return { lobby, crew: crew.data as { name: string; invite_code: string }, board };
}

function LobbyPage() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [crew, setCrew] = useState<{ name: string; invite_code: string } | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const loadBoard = useCallback((lobbyId: string) => {
    fetchBoard(lobbyId).then(setBoard, (e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLobby(code).then(
      ({ lobby, crew, board }) => {
        if (cancelled) return;
        setLobby(lobby);
        setCrew(crew);
        setBoard(board);
      },
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  const closed = lobby ? isClosed(lobby, now) : false;

  // While open: tick the countdown and poll for new entries.
  useEffect(() => {
    if (!lobby || closed) return;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadBoard(lobby.id);
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [lobby, closed, loadBoard]);

  // When the deadline passes, fetch once more so hidden scores are revealed.
  const lobbyId = lobby?.id;
  useEffect(() => {
    if (lobbyId && closed) fetchBoard(lobbyId).then(setBoard, (e) => setError(errorMessage(e)));
  }, [lobbyId, closed]);

  async function closeNow() {
    if (!lobby || !confirm("Close this lobby now and declare the winner?")) return;
    try {
      setLobby(await rpc<Lobby>("close_lobby", { p_lobby: lobby.id }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function voidEntry(row: BoardRow) {
    if (!lobby || !confirm(`Void ${row.display_name}'s entry? They'll be able to submit again.`)) return;
    try {
      await rpc("void_entry", { p_entry: row.entry_id });
      loadBoard(lobby.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error && !lobby) return <p className="error">{error}</p>;
  if (!lobby || !crew) return <Loading />;

  const game = getGame(lobby.game);
  const isHost = lobby.created_by === user?.id;
  const submitted = board.some((r) => r.user_id === user?.id);

  return (
    <div className="stack-lg">
      <section className="stack">
        <p className="eyebrow">
          <Link href={`/c/${crew.invite_code}`}>{crew.name}</Link> · lobby
        </p>
        <div className="row between wrap">
          <h1 className="title">
            {game.name.toUpperCase()} {game.puzzleLabel(lobby.puzzle_id)}
          </h1>
          {closed ? (
            <span className="pill">FINAL · {formatDay(endedAt(lobby))}</span>
          ) : (
            <span className="pill pill-live">● LIVE · {timeLeft(lobby.closes_at, now)} left</span>
          )}
        </div>
        {!closed && (
          <div className="row wrap">
            <CopyLink path={`/l/${lobby.invite_code}`} label="Share lobby" />
            {isHost && (
              <button className="btn btn-small" onClick={closeNow}>
                Close now
              </button>
            )}
          </div>
        )}
      </section>

      {!closed && !submitted && <SubmitPanel lobby={lobby} onSubmitted={() => loadBoard(lobby.id)} />}

      <Scoreboard lobby={lobby} rows={board} closed={closed} isHost={isHost} onVoid={voidEntry} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
