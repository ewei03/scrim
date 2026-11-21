"use client";

import { useState } from "react";
import { customOf, failLabel, parseTime, type CustomGame, type CustomResult } from "@/games/custom";
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
  const custom = customOf(game);
  if (custom) return <CustomSubmit crew={crew} game={game} custom={custom} puzzleId={puzzleId} onSubmitted={onSubmitted} />;
  return <AutoOrPaste crew={crew} game={game} puzzleId={puzzleId} extension={extension} onSubmitted={onSubmitted} />;
}

function AutoOrPaste({
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

/** Custom games: Scrim can't read them, so the score is typed in. */
function CustomSubmit({
  crew,
  game,
  custom,
  puzzleId,
  onSubmitted,
}: Target & { custom: CustomGame; onSubmitted: () => void }) {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What was typed, as a value, or why it isn't one yet.
  let value: number | null = null;
  let problem: string | null = null;
  if (!failed && text.trim()) {
    if (custom.score_type === "time") {
      value = parseTime(text);
      if (value === null || value <= 0) problem = "Enter a time like 4:05.";
    } else {
      value = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(value)) problem = "Enter a number.";
      else if (custom.score_type === "attempts" && (!Number.isInteger(value) || value < 1 || value > (custom.max_attempts ?? 1000)))
        problem = `Enter a whole number from 1 to ${custom.max_attempts ?? 1000}.`;
    }
  }
  const result: CustomResult | null = failed
    ? { puzzle: puzzleId, failed: true }
    : value !== null && !problem
      ? { puzzle: puzzleId, value }
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("submit_entry", { p_crew: crew.id, p_game: game.id, p_result: result, p_raw: null, p_source: "manual" });
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const placeholder =
    custom.score_type === "time"
      ? custom.time_format === "h:mm:ss"
        ? "e.g. 1:04:05"
        : custom.time_format === "m:ss.s"
          ? "e.g. 4:05.3"
          : "e.g. 4:05"
      : custom.score_type === "attempts"
        ? custom.max_attempts
          ? `1 to ${custom.max_attempts}`
          : "e.g. 4"
        : custom.unit
          ? `Your score, in ${custom.unit}`
          : "Your score";

  return (
    <section className="card stack">
      <div className="row between wrap">
        <strong>Your turn</strong>
        {game.url && (
          <a className="btn btn-primary btn-small" href={game.url} target="_blank" rel="noreferrer">
            Play {game.name} ↗
          </a>
        )}
      </div>
      {custom.instructions && <p>{custom.instructions}</p>}
      <form className="stack" onSubmit={submit}>
        <div className="row input-row">
          <input
            className="input grow"
            inputMode={custom.score_type === "time" ? "text" : "decimal"}
            aria-label={`Your ${game.name} score`}
            placeholder={placeholder}
            value={text}
            disabled={failed}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn btn-primary" disabled={!result || busy}>
            {busy ? "Submitting…" : "Lock it in"}
          </button>
        </div>
        {custom.allow_fail && (
          <label className="check">
            <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> {failLabel(custom)}
          </label>
        )}
        {problem && <p className="error small">{problem}</p>}
        {result && !failed && (
          <p className="muted small">
            Shows as <strong>{game.formatScore(result)}</strong>
          </p>
        )}
      </form>
      <p className="muted small">
        Scores for custom games are entered by hand, on the honour system. You get one submission per day.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
