"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { gameList, getGame } from "@/games/registry";
import { errorMessage, rpc } from "@/lib/supabase";
import { DEADLINE_PRESETS, deadlineFrom, type DeadlinePreset } from "@/lib/time";
import type { Lobby } from "@/lib/types";

export function NewLobbyForm({ crewId }: { crewId: string }) {
  const router = useRouter();
  const games = gameList();
  const [gameId, setGameId] = useState(games[0].id);
  const [deadline, setDeadline] = useState<DeadlinePreset>("midnight");
  const [hide, setHide] = useState(true);
  const [allowManual, setAllowManual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lobby = await rpc<Lobby>("create_lobby", {
        p_crew: crewId,
        p_game: gameId,
        // Only today's puzzle for now (the server enforces this too).
        p_puzzle: getGame(gameId).currentPuzzleId(),
        p_closes_at: deadlineFrom(deadline).toISOString(),
        p_hide_until_submitted: hide,
        p_allow_manual: allowManual,
      });
      router.push(`/l/${lobby.invite_code}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={create}>
      <h2>New lobby</h2>
      <div className="grid-2">
        <label className="field">
          <span>Game</span>
          <select
            className="input"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Puzzle</span>
          <div className="input readonly">
            {getGame(gameId).puzzleLabel(getGame(gameId).currentPuzzleId())} · today
          </div>
        </div>
        <label className="field">
          <span>Closes</span>
          <select className="input" value={deadline} onChange={(e) => setDeadline(e.target.value as DeadlinePreset)}>
            {DEADLINE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide scores until
        you submit (no spoilers)
      </label>
      <label className="check">
        <input type="checkbox" checked={allowManual} onChange={(e) => setAllowManual(e.target.checked)} /> Allow
        manual entry (otherwise paste only)
      </label>
      <p className="muted small">{getGame(gameId).blurb}</p>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create lobby"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
