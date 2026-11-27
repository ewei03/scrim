// Pure Angledle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From angledle.com's code (checked 2026-11-26): the daily Guess is in
// localStorage "adl-v1-game-state": { guesses: [{ guess, target, difference,
// proximity, direction }], status: "playing" | "won" | "lost", targetAngle,
// puzzleNumber }. proximity is exact (0°), very-close (≤5°), close (≤15°),
// warm (≤30°) or far; direction is higher, lower or correct. Puzzles are
// numbered from 2022-01-01 by local date, but the day starts at 6 am. Draw It
// and Higher/Lower ("adl-v1-drawit-state", "…-higherlower-state") aren't read.
// Only the closeness and direction are sent, not the angles. No accounts.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 0, 1);
  const DAY_MS = 86400000;
  const DAY_STARTS_AT = 6;
  const MAX_GUESSES = 6;
  const CLOSENESS = { exact: "g", "very-close": "g", close: "y", warm: "o", far: "r" };
  const WAY = { higher: "u", lower: "d", correct: "c" };

  /** Angledle's puzzle number at `ms` (local time; the day starts at 6 am). */
  function numberAt(ms) {
    const d = new Date(ms);
    if (d.getHours() < DAY_STARTS_AT) d.setDate(d.getDate() - 1);
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / DAY_MS);
  }

  /**
   * The saved Guess, if it's over and from today's or yesterday's puzzle
   * (`today` is today's number). `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    let s;
    try {
      s = JSON.parse(entries.find(([k]) => k === "adl-v1-game-state")?.[1] ?? "null");
    } catch {
      return [];
    }
    if (!s || (s.status !== "won" && s.status !== "lost") || !Array.isArray(s.guesses)) return [];
    const puzzle = Number(s.puzzleNumber);
    if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today) return [];
    const grid = s.guesses.map((g) => (CLOSENESS[g?.proximity] ?? "?") + (WAY[g?.direction] ?? "?"));
    const solved = s.status === "won";
    if (grid.length === 0 || grid.length > MAX_GUESSES || (!solved && grid.length < MAX_GUESSES)) return [];
    for (let i = 0; i < grid.length; i++) {
      if (!/^(g[udc]|[yor][ud])$/.test(grid[i])) return [];
      if ((grid[i] === "gc") !== (solved && i === grid.length - 1)) return [];
    }
    return [{ puzzle: String(puzzle), solved, guesses: grid.length, grid }];
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, guesses: g.solved ? g.guesses : null, grid: g.grid };
  }

  const DOTS = { g: "🟢", y: "🟡", o: "🟠", r: "🔴" };
  const ARROWS = { u: "↑", d: "↓", c: "✓" };

  /** Same layout as Angledle's own share. */
  function shareText(result) {
    const rows = result.grid.map((row) => `${DOTS[row[0]]} ${ARROWS[row[1]]}`);
    return [`Angledle #${result.puzzle} ${result.solved ? result.guesses : "X"}/6`, ...rows, "angledle.com"].join("\n");
  }

  function formatScore(result) {
    return `${result.solved ? result.guesses : "X"}/6`;
  }

  const api = { numberAt, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimAngledle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
