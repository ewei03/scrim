"use client";

import { useState } from "react";
import { manualConnections, type ConnectionsResult } from "./connections";
import { manualKrillion, PROMPTS, TIERS, type KrillionResult } from "./krillion";
import { manualWordle, type WordleResult } from "./wordle";

/** Game-specific pieces of UI, keyed by game id. */

export function ResultDetail({ gameId, result }: { gameId: string; result: unknown }) {
  if (gameId === "wordle") {
    const grid = (result as WordleResult).grid;
    return grid ? <WordleGrid grid={grid} /> : null;
  }
  if (gameId === "connections") {
    const grid = (result as ConnectionsResult).grid;
    return grid ? <ConnectionsGrid grid={grid} /> : null;
  }
  if (gameId === "krillion") {
    const tiers = (result as KrillionResult).tiers;
    return tiers ? <KrillionTiers tiers={tiers} /> : null;
  }
  return null;
}

export function ManualEntry({
  gameId,
  puzzleId,
  onChange,
}: {
  gameId: string;
  puzzleId: string;
  onChange: (result: unknown | null) => void;
}) {
  if (gameId === "wordle") return <WordleManual puzzleId={puzzleId} onChange={onChange} />;
  if (gameId === "connections") return <ConnectionsManual puzzleId={puzzleId} onChange={onChange} />;
  if (gameId === "krillion") return <KrillionManual puzzleId={puzzleId} onChange={onChange} />;
  return <p className="muted">Manual entry isn&apos;t available for this game.</p>;
}

export function WordleGrid({ grid, size = "small" }: { grid: string[]; size?: "small" | "large" }) {
  return (
    <div className={`wgrid wgrid-${size}`} aria-label="Wordle grid">
      {grid.map((row, i) => (
        <div key={i} className="wrow">
          {Array.from(row).map((c, j) => (
            <span key={j} className={`wtile ${c === "g" ? "wg" : c === "y" ? "wy" : "wx"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function WordleManual({ puzzleId, onChange }: { puzzleId: string; onChange: (r: unknown | null) => void }) {
  const [guesses, setGuesses] = useState<number | null | undefined>(undefined);
  const [hard, setHard] = useState(false);

  function update(g: number | null | undefined, h: boolean) {
    setGuesses(g);
    setHard(h);
    onChange(g === undefined ? null : manualWordle(puzzleId, g, h));
  }

  return (
    <div className="stack">
      <div className="row wrap" role="radiogroup" aria-label="Guesses">
        {[1, 2, 3, 4, 5, 6, null].map((g) => (
          <button
            key={String(g)}
            type="button"
            role="radio"
            aria-checked={guesses === g}
            className={`btn btn-square ${guesses === g ? "btn-primary" : ""}`}
            onClick={() => update(g, hard)}
          >
            {g ?? "X"}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={hard} onChange={(e) => update(guesses, e.target.checked)} /> Hard mode
      </label>
    </div>
  );
}

export function ConnectionsGrid({ grid }: { grid: string[] }) {
  return (
    <div className="wgrid" aria-label="Connections grid">
      {grid.map((row, i) => (
        <div key={i} className="wrow">
          {Array.from(row).map((c, j) => (
            <span key={j} className={`wtile c${c}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function KrillionTiers({ tiers }: { tiers: string }) {
  return (
    <span className="ktiers" aria-label="Answer rarity">
      {Array.from(tiers).map((c, i) => (
        <span key={i} title={`${TIERS[c]?.name} · ${TIERS[c]?.points} pts`}>
          {TIERS[c]?.emoji}
        </span>
      ))}
    </span>
  );
}

function ConnectionsManual({ puzzleId, onChange }: { puzzleId: string; onChange: (r: unknown | null) => void }) {
  // undefined = nothing picked yet; null = lost (four mistakes).
  const [mistakes, setMistakes] = useState<number | null | undefined>(undefined);
  const [groups, setGroups] = useState(0);

  function update(m: number | null | undefined, g: number) {
    setMistakes(m);
    setGroups(g);
    onChange(m === undefined ? null : manualConnections(puzzleId, m, g));
  }

  return (
    <div className="stack">
      <span className="muted small">Mistakes</span>
      <div className="row wrap" role="radiogroup" aria-label="Mistakes">
        {[0, 1, 2, 3, null].map((m) => (
          <button
            key={String(m)}
            type="button"
            role="radio"
            aria-checked={mistakes === m}
            className={`btn btn-square ${mistakes === m ? "btn-primary" : ""}`}
            onClick={() => update(m, groups)}
            title={m === null ? "Ran out of mistakes" : undefined}
          >
            {m ?? "X"}
          </button>
        ))}
      </div>
      {mistakes === null && (
        <>
          <span className="muted small">Groups found before you ran out</span>
          <div className="row wrap" role="radiogroup" aria-label="Groups found">
            {[0, 1, 2, 3].map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={groups === g}
                className={`btn btn-square ${groups === g ? "btn-primary" : ""}`}
                onClick={() => update(null, g)}
              >
                {g}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KrillionManual({ puzzleId, onChange }: { puzzleId: string; onChange: (r: unknown | null) => void }) {
  const [meters, setMeters] = useState("");
  const max = PROMPTS * 100 * 10;

  function update(value: string) {
    setMeters(value);
    const m = Number(value.replace(/[,\s]/g, ""));
    // Depth is points × 10, and every tier is worth a multiple of 5 points.
    const valid = value.trim() !== "" && Number.isInteger(m) && m >= 0 && m <= max && m % 50 === 0;
    onChange(valid ? manualKrillion(puzzleId, m / 10) : null);
  }

  return (
    <label className="field">
      <span>Depth in metres</span>
      <input
        className="input"
        inputMode="numeric"
        placeholder="e.g. 3600"
        value={meters}
        onChange={(e) => update(e.target.value)}
      />
      <span className="muted small">Up to {max.toLocaleString("en-US")} m, in steps of 50.</span>
    </label>
  );
}
