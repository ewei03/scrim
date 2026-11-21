"use client";

import { useState } from "react";
import {
  CUSTOM_COLORS,
  SCORE_TYPES,
  failLabel,
  formatCustomValue,
  type CustomGame,
  type CustomSettings,
  type ScoreType,
  type TimeFormat,
} from "@/games/custom";
import { errorMessage, rpc } from "@/lib/supabase";

const TIME_FORMATS: { id: TimeFormat; label: string }[] = [
  { id: "m:ss", label: "Minutes and seconds (4:05)" },
  { id: "h:mm:ss", label: "Hours, minutes and seconds (1:04:05)" },
  { id: "m:ss.s", label: "Down to tenths of a second (4:05.3)" },
];

/** What a score looks like with these settings, as an example. */
function example(s: CustomSettings): string {
  const value = s.score_type === "time" ? 245.3 : s.score_type === "attempts" ? Math.min(4, s.max_attempts ?? 4) : 1234.5;
  return formatCustomValue(s, value);
}

/**
 * Create or edit a custom game. Scoring settings can't change once anyone has
 * entered a score (the server enforces it; `scoringLocked` just says so up front).
 */
export function CustomGameForm({
  crewId,
  game,
  takenColors,
  scoringLocked,
  onSaved,
  onDeleted,
  onCancel,
}: {
  crewId: string;
  /** Set when editing. */
  game?: CustomGame;
  /** Colours other games in the crew already use, picked last by default. */
  takenColors: string[];
  scoringLocked: boolean;
  onSaved: (game: CustomGame) => void;
  /** After the game (being edited) is deleted. */
  onDeleted?: (game: CustomGame) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<CustomSettings>(() =>
    game
      ? { ...game }
      : {
          name: "",
          url: null,
          instructions: null,
          color: CUSTOM_COLORS.find((c) => !takenColors.includes(c)) ?? CUSTOM_COLORS[0],
          score_type: "points",
          higher_is_better: true,
          decimals: 0,
          unit: null,
          time_format: "m:ss",
          max_attempts: null,
          allow_fail: false,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CustomSettings>) => setS((prev) => ({ ...prev, ...patch }));

  function pickType(type: ScoreType) {
    // Each type starts with the usual direction: most points wins, fastest time and fewest tries win.
    set({ score_type: type, higher_is_better: SCORE_TYPES.find((t) => t.id === type)!.higherIsBetter });
  }

  async function remove() {
    if (!game) return;
    if (
      !confirm(
        `Delete ${game.name}? Its scores, past days and rankings in this crew are deleted too. This can't be undone.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await rpc("delete_custom_game", { p_game: game.id });
      onDeleted?.(game);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const settings = { ...s, url: s.url?.trim() || null, instructions: s.instructions?.trim() || null };
      const saved = game
        ? await rpc<CustomGame>("update_custom_game", { p_game: game.id, p_settings: settings })
        : await rpc<CustomGame>("create_custom_game", { p_crew: crewId, p_settings: settings });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack custom-form" onSubmit={save}>
      <p className="muted small">
        <strong>Scores will be entered manually.</strong>
      </p>

      <label className="field">
        <span>Name</span>
        <input
          className="input"
          value={s.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={40}
          required
          placeholder="e.g. Mini Crossword"
        />
      </label>

      <label className="field">
        <span>Link to the game (optional)</span>
        <input
          className="input"
          type="url"
          value={s.url ?? ""}
          onChange={(e) => set({ url: e.target.value })}
          maxLength={300}
          placeholder="https://…"
        />
      </label>

      <label className="field">
        <span>Instructions for players (optional)</span>
        <input
          className="input"
          value={s.instructions ?? ""}
          onChange={(e) => set({ instructions: e.target.value })}
          maxLength={200}
          placeholder="e.g. Enter your time from the results screen"
        />
      </label>

      <fieldset className="field custom-fieldset">
        <legend>Colour</legend>
        <div className="swatches">
          {CUSTOM_COLORS.map((c) => (
            <label key={c} className="swatch" style={{ background: c }} title={c}>
              <input
                type="radio"
                name="custom-color"
                value={c}
                checked={s.color === c}
                onChange={() => set({ color: c })}
                aria-label={`Colour ${c}`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {scoringLocked && (
        <p className="muted small">Scoring is locked now that people have entered scores; only the details above can change.</p>
      )}

      <fieldset className="field custom-fieldset" disabled={scoringLocked}>
        <legend>Score type</legend>
        <div className="choice-cards">
          {SCORE_TYPES.map((t) => (
            <label key={t.id} className={`choice-card ${s.score_type === t.id ? "chosen" : ""}`}>
              <input
                type="radio"
                name="score-type"
                value={t.id}
                checked={s.score_type === t.id}
                onChange={() => pickType(t.id)}
              />
              <strong>{t.label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field custom-fieldset" disabled={scoringLocked}>
        {s.score_type === "points" && (
          <div className="row wrap">
            <label className="field grow">
              <span>Decimals</span>
              <select
                className="input"
                value={s.decimals}
                onChange={(e) => set({ decimals: Number(e.target.value) })}
              >
                <option value={0}>Whole numbers (1,234)</option>
                <option value={1}>1 decimal place (1,234.5)</option>
                <option value={2}>2 decimal places (1,234.50)</option>
              </select>
            </label>
            <label className="field grow">
              <span>Unit (optional)</span>
              <input
                className="input"
                value={s.unit ?? ""}
                onChange={(e) => set({ unit: e.target.value })}
                maxLength={12}
                placeholder="e.g. pts, m"
              />
            </label>
          </div>
        )}
        {s.score_type === "time" && (
          <select
            className="input"
            aria-label="Time format"
            value={s.time_format ?? "m:ss"}
            onChange={(e) => set({ time_format: e.target.value as TimeFormat })}
          >
            {TIME_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        )}
        {s.score_type === "attempts" && (
          <label className="field">
            <span>Most attempts allowed (optional)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={s.max_attempts ?? ""}
              onChange={(e) => set({ max_attempts: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 6, to show scores like 4/6"
            />
          </label>
        )}
        <p className="muted small">
          Scores will look like <strong>{example(s)}</strong>
        </p>
      </fieldset>

      <fieldset className="field custom-fieldset" disabled={scoringLocked}>
        <legend>Who wins</legend>
        <div className="row wrap">
          <label className="check">
            <input
              type="radio"
              name="direction"
              checked={!s.higher_is_better}
              onChange={() => set({ higher_is_better: false })}
            />{" "}
            Lowest {s.score_type === "time" ? "time" : s.score_type === "attempts" ? "attempts" : "score"} wins
          </label>
          <label className="check">
            <input
              type="radio"
              name="direction"
              checked={s.higher_is_better}
              onChange={() => set({ higher_is_better: true })}
            />{" "}
            Highest {s.score_type === "time" ? "time" : s.score_type === "attempts" ? "attempts" : "score"} wins
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.allow_fail} onChange={(e) => set({ allow_fail: e.target.checked })} />{" "}
          Players can enter &quot;{failLabel(s)}&quot; (it ranks last and can&apos;t win)
        </label>
      </fieldset>

      <div className="row wrap">
        <button className="btn btn-primary" disabled={busy || !s.name.trim()}>
          {busy ? "Saving…" : game ? "Save changes" : "Add game"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {game && (
          <button type="button" className="btn btn-danger custom-delete" disabled={busy} onClick={remove}>
            Delete game
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
