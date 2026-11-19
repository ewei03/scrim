"use client";

import { useState } from "react";
import { manualWordle, type WordleResult } from "./wordle";

/** Game-specific pieces of UI, keyed by game id. */

export function ResultDetail({ gameId, result }: { gameId: string; result: unknown }) {
  if (gameId === "wordle") {
    const grid = (result as WordleResult).grid;
    return grid ? <WordleGrid grid={grid} /> : null;
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
