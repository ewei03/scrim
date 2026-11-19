"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { gameList, getGame } from "@/games/registry";
import { errorMessage, rpc } from "@/lib/supabase";
import { nextMidnight } from "@/lib/time";
import type { Lobby } from "@/lib/types";

export function NewLobbyForm({ crewId }: { crewId: string }) {
  const router = useRouter();
  const games = gameList();
  const [gameId, setGameId] = useState(games[0].id);
  const [hide, setHide] = useState(true);
  const [allowManual, setAllowManual] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
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
        // Lobbies close when the puzzle rolls over to the next day's.
        p_closes_at: nextMidnight().toISOString(),
        p_hide_until_submitted: hide,
        p_allow_manual: allowManual,
      });
      router.push(`/l/${lobby.invite_code}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const game = getGame(gameId);

  return (
    <form className="card stack" onSubmit={create}>
      <div className="row between">
        <h2>
          New lobby{" "}
          <span className="muted small">
            · {game.name} {game.puzzleLabel(game.currentPuzzleId())} · today
          </span>
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Lobby settings"
          aria-haspopup="dialog"
          title="Lobby settings"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Lobby settings">
        <label className="check">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide scores until
          you submit (no spoilers)
        </label>
        <label className="check">
          <input type="checkbox" checked={allowManual} onChange={(e) => setAllowManual(e.target.checked)} />{" "}
          Allow manual entry (otherwise paste only)
        </label>
        <button type="button" className="btn btn-primary" onClick={() => setShowSettings(false)}>
          Done
        </button>
      </Modal>
      <label className="field">
        <span>Game</span>
        <select className="input" value={gameId} onChange={(e) => setGameId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        {game.blurb} Closes at midnight, when the next puzzle drops.
      </p>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create lobby"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
