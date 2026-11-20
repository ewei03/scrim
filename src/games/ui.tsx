"use client";

import type { ConnectionsResult } from "./connections";
import { TIERS, type KrillionResult } from "./krillion";
import type { WordleResult } from "./wordle";

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

