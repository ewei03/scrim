"use client";

import type { ConnectionsResult } from "./connections";
import type { ContextoResult } from "./contexto";
import { closeness, money, shortMoney, type CostcodleResult } from "./costcodle";
import { TIERS, type KrillionResult } from "./krillion";
import { foldPath, type PoopleResult } from "./poople";
import type { StrandsResult } from "./strands";
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
  if (gameId === "strands") {
    const grid = (result as StrandsResult).grid;
    return grid ? <StrandsDots grid={grid} /> : null;
  }
  if (gameId === "krillion") {
    const tiers = (result as KrillionResult).tiers;
    return tiers ? <KrillionTiers tiers={tiers} /> : null;
  }
  if (gameId === "contexto") {
    const chart = (result as ContextoResult).chart;
    return chart ? <ContextoChart chart={chart} /> : null;
  }
  if (gameId === "costcodle") {
    const offs = (result as CostcodleResult).offs;
    return offs ? <CostcodleItems offs={offs} /> : null;
  }
  if (gameId === "poople") {
    const grid = (result as PoopleResult).grid;
    return grid ? <PoopleGrid grid={grid} /> : null;
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

/** Strands' share, four to a row: theme words, the spangram and hints, in the order they came. */
export function StrandsDots({ grid }: { grid: string }) {
  const rows = Array.from(grid).reduce<string[][]>((acc, c, i) => {
    if (i % 4 === 0) acc.push([]);
    acc[acc.length - 1].push(c);
    return acc;
  }, []);
  return (
    <div className="wgrid" aria-label="Strands result">
      {rows.map((row, i) => (
        <div key={i} className="wrow">
          {row.map((c, j) => (
            <span key={j} className={`sdot s${c}`} title={c === "s" ? "Spangram" : c === "h" ? "Hint" : "Theme word"} />
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


/** Contexto's bars: how many guesses were close (green), near (yellow) and far (red). */
function ContextoChart({ chart }: { chart: [number, number, number] }) {
  const total = Math.max(1, chart[0] + chart[1] + chart[2]);
  const labels = ["Close", "Near", "Far"];
  return (
    <div className="cchart" aria-label="Contexto guesses">
      {chart.map((n, i) => (
        <div key={i} className="cchart-row" title={`${labels[i]}: ${n}`}>
          <span className={`cbar cbar-${i}`} style={{ width: `${Math.max(n ? 6 : 0, (n / total) * 100)}%` }} />
          <span className="cchart-n">{n}</span>
        </div>
      ))}
    </div>
  );
}

/** Costcodle: how far off each of the five guesses was, coloured by how close. */
function CostcodleItems({ offs }: { offs: number[] }) {
  return (
    <span className="citems" aria-label={`Off by ${offs.map(money).join(", ")}`}>
      {offs.map((c, i) => (
        <span key={i} className={`citem citem-${closeness(c)}`} title={`Item ${i + 1}: off ${money(c)}`}>
          {shortMoney(c)}
        </span>
      ))}
    </span>
  );
}

/**
 * Poople's share: a row per word, brown where a letter matches POOP. A long
 * path shows its start and finish with "+N" for the rows in between.
 */
function PoopleGrid({ grid }: { grid: string[] }) {
  const { head, hidden, tail } = foldPath(grid);
  const row = (r: string, key: string) => (
    <div key={key} className="wrow">
      {Array.from(r).map((c, j) => (
        <span key={j} className={`wtile ${c === "p" ? "pp" : "wx"}`} />
      ))}
    </div>
  );
  return (
    <div className="wgrid" aria-label={`Poople path, ${grid.length} words`}>
      {head.map((r, i) => row(r, `h${i}`))}
      {hidden > 0 && (
        <span className="wfold" title={`${hidden} more words`}>
          +{hidden}
        </span>
      )}
      {tail.map((r, i) => row(r, `t${i}`))}
    </div>
  );
}
