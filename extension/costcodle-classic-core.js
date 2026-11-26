// Pure Costcodle Classic helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From costcodle.com's code (checked 2026-11-26), Classic mode keeps today's
// game in localStorage "state": { gameNumber, guesses: [{ guess, closeness:
// "guess-win" | "guess-near" | "guess-far", direction: "&uarr;" | "&darr;" |
// "&check;" }], hasWon }, and finished days in "stats".history[gameNumber]
// with the same guesses (an archive day marked done without them has none).
// Won within 5% of the price, lost after six. Numbered from 2 on 2023-09-21
// (local date), so #0 is 2023-09-19. Checkout ("checkoutState") is read by
// costcodle-core.js. There are no accounts.
(function (root) {
  const EPOCH_UTC = Date.UTC(2023, 8, 19);
  const DAY_MS = 86400000;
  const MAX_GUESSES = 6;

  /** "2026-11-26" -> 1164. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  function parse(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** A guess as the share draws it: "uy", "dr", "w" for the price; null if it isn't one. */
  function rowOf(guess) {
    if (guess?.closeness === "guess-win") return guess.direction === "&check;" ? "w" : null;
    const way = guess?.direction === "&uarr;" ? "u" : guess?.direction === "&darr;" ? "d" : null;
    const near = guess?.closeness === "guess-near" ? "y" : guess?.closeness === "guess-far" ? "r" : null;
    return way && near ? way + near : null;
  }

  /** The rows of a finished, possible game, or null. */
  function gridOf(guesses) {
    if (!Array.isArray(guesses) || guesses.length === 0 || guesses.length > MAX_GUESSES) return null;
    const grid = guesses.map(rowOf);
    if (grid.includes(null)) return null;
    // The price can only be hit once, at the end.
    if (grid.slice(0, -1).includes("w")) return null;
    if (grid[grid.length - 1] !== "w" && grid.length < MAX_GUESSES) return null;
    return grid;
  }

  /**
   * Finished Classic games from today's or yesterday's puzzle (`today` is its
   * number), newest first. Older ones are archive games. `entries` is
   * [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const get = (key) => parse(entries.find(([k]) => k === key)?.[1]);
    const found = new Map();
    const add = (gameNumber, guesses) => {
      const puzzle = Number(gameNumber);
      if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today || found.has(puzzle)) return;
      const grid = gridOf(guesses);
      if (!grid) return;
      const solved = grid[grid.length - 1] === "w";
      found.set(puzzle, { puzzle: String(puzzle), solved, guesses: grid.length, grid });
    };
    const state = get("state");
    if (state) add(state.gameNumber, state.guesses);
    for (const [n, entry] of Object.entries(get("stats")?.history ?? {})) add(n, entry?.guesses);
    return [...found.values()].sort((a, b) => Number(b.puzzle) - Number(a.puzzle));
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, guesses: g.solved ? g.guesses : null, grid: g.grid };
  }

  function formatScore(result) {
    return `${result.solved ? result.guesses : "X"}/6`;
  }

  /** Laid out like costcodle.com's own share text. */
  function shareText(result) {
    const rows = result.grid.map((row) =>
      row === "w" ? "✅" : (row[0] === "u" ? "⬆️" : "⬇️") + (row[1] === "y" ? "🟨" : "🟥"),
    );
    return `Costcodle Classic #${result.puzzle} ${formatScore(result)}\n${rows.join("\n")}\n\nPlay now at https://www.costcodle.com`;
  }

  const api = { numberFromDate, rowOf, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimCostcodleClassic = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
