"use client";

import { useState } from "react";
import { getGame } from "@/games/registry";
import { ManualEntry, ResultDetail } from "@/games/ui";
import { errorMessage, rpc } from "@/lib/supabase";
import type { Lobby } from "@/lib/types";

export function SubmitPanel({ lobby, onSubmitted }: { lobby: Lobby; onSubmitted: () => void }) {
  const game = getGame(lobby.game);
  const [mode, setMode] = useState<"paste" | "manual">("paste");
  const [text, setText] = useState("");
  const [manual, setManual] = useState<unknown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = text.trim() ? game.parseShareText(text) : null;
  const wrongPuzzle =
    parsed?.ok && (parsed.result as { puzzle: string }).puzzle !== lobby.puzzle_id
      ? (parsed.result as { puzzle: string }).puzzle
      : null;

  const result = mode === "paste" ? (parsed?.ok && !wrongPuzzle ? parsed.result : null) : manual;

  async function submit() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("submit_entry", {
        p_lobby: lobby.id,
        p_result: result,
        p_raw: mode === "paste" ? text : null,
        p_source: mode,
      });
      onSubmitted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="row between">
        <h2>Your turn</h2>
        <a className="btn btn-primary btn-small" href={game.url} target="_blank" rel="noreferrer">
          Play {game.name} ↗
        </a>
      </div>

      {lobby.allow_manual && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "paste"} onClick={() => setMode("paste")}>
            Paste result
          </button>
          <button role="tab" aria-selected={mode === "manual"} onClick={() => {
              setManual(null);
              setMode("manual");
            }}
          >
            Enter manually
          </button>
        </div>
      )}

      {mode === "paste" ? (
        <>
          <p className="muted small">{game.shareHint}</p>
          <textarea
            className="input mono"
            rows={7}
            placeholder={"Wordle 1,612 4/6\n\n⬛🟨⬛⬛⬛\n🟩⬛⬛🟨⬛\n🟩🟩⬛🟩⬛\n🟩🟩🟩🟩🟩"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {parsed && !parsed.ok && <p className="error">{parsed.error}</p>}
          {wrongPuzzle && (
            <p className="error">
              That&apos;s {game.name} {game.puzzleLabel(wrongPuzzle)}, but this lobby is for{" "}
              {game.puzzleLabel(lobby.puzzle_id)}.
            </p>
          )}
          {parsed?.ok && !wrongPuzzle && (
            <div className="row preview">
              <span className="score">{game.formatScore(parsed.result)}</span>
              <ResultDetail gameId={game.id} result={parsed.result} />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted small">Manual entries are marked ✎ on the scoreboard.</p>
          <ManualEntry gameId={game.id} puzzleId={lobby.puzzle_id} onChange={setManual} />
        </>
      )}

      <button className="btn btn-primary" disabled={!result || busy} onClick={submit}>
        {busy ? "Submitting…" : "Lock it in"}
      </button>
      <p className="muted small">You get one submission per lobby.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
