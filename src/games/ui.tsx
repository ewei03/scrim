"use client";

import type { AngledleResult } from "./angledle";
import type { ConnectionsResult } from "./connections";
import type { ContextoResult } from "./contexto";
import { closeness, money, type CostcodleResult } from "./costcodle";
import type { CostcodleClassicResult } from "./costcodle-classic";
import { TIERS, type KrillionResult } from "./krillion";
import type { MinecraftdleResult } from "./minecraftdle";
import type { NerdleResult } from "./nerdle";
import { EVENTS, type PerceptleResult } from "./perceptle";
import { foldPath, type PoopleResult } from "./poople";
import type { StrandsResult } from "./strands";
import type { WordleResult } from "./wordle";
import type { WorldleResult } from "./worldle";

/** Game-specific pieces of UI, keyed by game id. */

/** Games whose results have something to draw (ResultDetail): the rest get no Result column. */
const WITH_DETAIL: ReadonlySet<string> = new Set([
  "wordle",
  "connections",
  "strands",
  "krillion",
  "contexto",
  "costcodle",
  "costcodleclassic",
  "worldle",
  "nerdle",
  "poople",
  "perceptle",
  "minecraftdle",
  "minecraftdleitem",
  "minecraftdlemob",
  "angledle",
]);

export function hasResultDetail(gameId: string): boolean {
  return WITH_DETAIL.has(gameId);
}

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
  if (gameId === "costcodleclassic") {
    const grid = (result as CostcodleClassicResult).grid;
    return grid ? <ClassicGuesses grid={grid} /> : null;
  }
  if (gameId === "worldle") {
    const grid = (result as WorldleResult).grid;
    return grid ? <WordleGrid grid={grid} label="Worldle grid" /> : null;
  }
  if (gameId === "nerdle") {
    const grid = (result as NerdleResult).grid;
    return grid ? <WordleGrid grid={grid} label="Nerdle grid" /> : null;
  }
  if (gameId === "poople") {
    const grid = (result as PoopleResult).grid;
    return grid ? <PoopleGrid grid={grid} /> : null;
  }
  if (gameId === "perceptle") {
    const events = (result as PerceptleResult).events;
    return events ? <PerceptleEvents events={events} /> : null;
  }
  if (gameId === "minecraftdle" || gameId === "minecraftdleitem" || gameId === "minecraftdlemob") {
    const grid = (result as MinecraftdleResult).grid;
    return grid ? <MinecraftdleGrid grid={grid} /> : null;
  }
  if (gameId === "angledle") {
    const grid = (result as AngledleResult).grid;
    return grid ? <AngledleRows grid={grid} /> : null;
  }
  return null;
}

/** Wordle's grid, and others drawn the same way (Worldle's closeness, Nerdle's purple "p" for present). */
export function WordleGrid({
  grid,
  size = "small",
  label = "Wordle grid",
}: {
  grid: string[];
  size?: "small" | "large";
  label?: string;
}) {
  return (
    <div className={`wgrid wgrid-${size}`} aria-label={label}>
      {grid.map((row, i) => (
        <div key={i} className="wrow">
          {Array.from(row).map((c, j) => (
            <span key={j} className={`wtile ${c === "g" ? "wg" : c === "y" ? "wy" : c === "p" ? "np" : "wx"}`} />
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
          {money(c)}
        </span>
      ))}
    </span>
  );
}

/**
 * Costcodle Classic: a chip per guess, as its share draws them: red (more than
 * 25% off) or yellow (within 25%) with the way to go, green for the price.
 */
function ClassicGuesses({ grid }: { grid: string[] }) {
  const say = (row: string) =>
    row === "w" ? "got it" : `${row[0] === "u" ? "higher" : "lower"}, ${row[1] === "y" ? "within 25%" : "over 25% off"}`;
  return (
    <span className="citems citems-classic" aria-label={`Guesses: ${grid.map(say).join("; ")}`}>
      {grid.map((row, i) => (
        <span
          key={i}
          className={`citem ${row === "w" ? "citem-near" : row[1] === "y" ? "citem-mid" : "citem-far"}`}
          title={`Guess ${i + 1}: ${say(row)}`}
        >
          {row === "w" ? "✓" : row[0] === "u" ? "↑" : "↓"}
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

/** Perceptle: each test's score out of 100, coloured like Costcodle's chips by how good it was. */
function PerceptleEvents({ events }: { events: number[] }) {
  const tone = (n: number) => (n >= 85 ? "near" : n >= 55 ? "mid" : "far");
  return (
    <span className="citems" aria-label={EVENTS.map((e, i) => `${e.name} ${events[i]}`).join(", ")}>
      {events.map((n, i) => (
        <span key={i} className={`citem citem-${tone(n)}`} title={`${EVENTS[i]?.name}: ${n}`}>
          {EVENTS[i]?.emoji} {n}
        </span>
      ))}
    </span>
  );
}

/**
 * Minecraftdle: a row per guess, a square per trait (green right, red wrong,
 * yellow for higher or lower). A long game shows its start and finish with
 * "+N" for the rows in between.
 */
function MinecraftdleGrid({ grid }: { grid: string[] }) {
  const { head, hidden, tail } = foldPath(grid);
  const row = (r: string, key: string) => (
    <div key={key} className="wrow">
      {Array.from(r).map((c, j) => (
        <span key={j} className={`wtile ${c === "c" ? "wg" : c === "x" ? "mx" : "wy"}`} />
      ))}
    </div>
  );
  return (
    <div className="wgrid" aria-label={`Minecraftdle, ${grid.length} tries`}>
      {head.map((r, i) => row(r, `h${i}`))}
      {hidden > 0 && (
        <span className="wfold" title={`${hidden} more tries`}>
          +{hidden}
        </span>
      )}
      {tail.map((r, i) => row(r, `t${i}`))}
    </div>
  );
}

const ANGLE_DOTS: Record<string, string> = { g: "🟢", y: "🟡", o: "🟠", r: "🔴" };
const ANGLE_WAYS: Record<string, string> = { u: "↑", d: "↓", c: "✓" };
const ANGLE_NEAR: Record<string, string> = { g: "within 5°", y: "within 15°", o: "within 30°", r: "over 30° off" };

/** Angledle: a dot per guess for how close it was, and the way to go next. */
function AngledleRows({ grid }: { grid: string[] }) {
  const say = (row: string) =>
    row[1] === "c"
      ? "got it"
      : row[1]
        ? `${ANGLE_NEAR[row[0]]}, go ${row[1] === "u" ? "higher" : "lower"}`
        : ANGLE_NEAR[row[0]];
  return (
    <span className="ktiers" aria-label={`Angledle guesses: ${grid.map(say).join("; ")}`}>
      {grid.map((row, i) => (
        <span key={i} title={`Guess ${i + 1}: ${say(row)}`}>
          {ANGLE_DOTS[row[0]]}
          {row[1] ? ANGLE_WAYS[row[1]] : null}
        </span>
      ))}
    </span>
  );
}
