"use client";

import { useState } from "react";
import type { GameAdapter } from "@/games/types";
import { ResultDetail } from "@/games/ui";
import type { ExtensionState } from "@/lib/extension";
import { errorMessage, rpc } from "@/lib/supabase";
import type { Crew } from "@/lib/types";
import Link from "next/link";

type Target = { crew: Crew; game: GameAdapter<unknown>; puzzleId: string };

export function SubmitPanel({
  crew,
  game,
  puzzleId,
  extension,
  onSubmitted,
}: Target & {
  extension: ExtensionState;
  onSubmitted: () => void;
}) {
  // Only some games can be captured by the extension.
  const ext = game.autoSubmit ? extension : null;
  const auto = ext === "connected";
  // The paste box starts hidden; the toggle reveals it.
  const [showEntry, setShowEntry] = useState(false);

  return (
    <section className="card stack">
      <div className="row between wrap">
        <strong>Your turn</strong>
        <a className="btn btn-primary btn-small" href={game.url} target="_blank" rel="noreferrer">
          Play {game.name} ↗
        </a>
      </div>

      {auto ? (
        <p>
          Start playing! Your results will automatically show up here.
        </p>
      ) : ext === null || ext === "checking" ? null : (
        <p className="muted small">
          {ext === "missing"
            ? "Enable the Scrim extension to ensure your score is submitted automatically."
            : "Connect the Scrim extension to submit automatically."}
          <br />
          <Link href="/profile">Set it up on your profile →</Link>
        </p>
      )}

      <div className="fallback">
        <button
          type="button"
          className="fallback-toggle"
          aria-expanded={showEntry}
          onClick={() => setShowEntry((s) => !s)}
        >
          {showEntry ? "▾" : "▸"}{" "}
          {auto ? "Not working? Paste your result instead" : "Or, paste your result"}
        </button>
        {showEntry && (
          <div>
            <PasteSubmit crew={crew} game={game} puzzleId={puzzleId} onSubmitted={onSubmitted} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Fallback when the extension can't capture a result: paste the game's share text. */
function PasteSubmit({ crew, game, puzzleId, onSubmitted }: Target & { onSubmitted: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = text.trim() ? game.parseShareText(text) : null;
  const wrongPuzzle =
    parsed?.ok && (parsed.result as { puzzle: string }).puzzle !== puzzleId
      ? (parsed.result as { puzzle: string }).puzzle
      : null;

  const result = parsed?.ok && !wrongPuzzle ? parsed.result : null;

  async function submit() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("submit_entry", {
        p_crew: crew.id,
        p_game: game.id,
        p_result: result,
        p_raw: text,
        p_source: "paste",
      });
      onSubmitted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fallback-body">
      <p className="muted small">{game.shareHint}</p>
      <textarea
        className="input mono"
        rows={7}
        placeholder={game.sharePlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {parsed && !parsed.ok && <p className="error">{parsed.error}</p>}
      {wrongPuzzle && (
        <p className="error">
          That&apos;s {game.name} {game.puzzleLabel(wrongPuzzle)}, but today&apos;s is{" "}
          {game.puzzleLabel(puzzleId)}.
        </p>
      )}
      {parsed?.ok && !wrongPuzzle && (
        <div className="row preview">
          <span className="score">{game.formatScore(parsed.result)}</span>
          <ResultDetail gameId={game.id} result={parsed.result} />
        </div>
      )}

      <button className="btn btn-primary" disabled={!result || busy} onClick={submit}>
        {busy ? "Submitting…" : "Lock it in"}
      </button>
      <p className="muted small">You get one submission per puzzle.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
