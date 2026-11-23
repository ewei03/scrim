// Pure Strands helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From NYT's saved state (checked 2026-11-23): progress is in localStorage
// under "games-state-strands/<regiId|ANON>" as
// { states: [{ puzzleId, printDate, data }] }, where data is
//   { history: [{ t: "THEME" | "SPANGRAM" | "HINT", w }], otherWordsFound, isSolved, isPlayingArchive }.
// The history is in the order things happened, the same order as the share's
// dots. puzzleId is NYT's internal id; Scrim numbers puzzles by printDate.
(function (root) {
  const EPOCH_UTC = Date.UTC(2024, 2, 3); // Strands #1 was 2024-03-04
  const DAY_MS = 86400000;
  const STATE_KEY = /^games-state-strands\//;
  const LETTER = { THEME: "b", SPANGRAM: "s", HINT: "h" };
  const EMOJI = { b: "🔵", s: "🟡", h: "💡" };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_TILES = 40;

  /** "2026-11-23" -> 994. */
  function numberFromPrintDate(printDate) {
    const [y, m, d] = printDate.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /** The NYT account a save belongs to (its regiId), or null when signed out. */
  function accountOf(key) {
    const account = key.split("/")[1] ?? "";
    return account !== "" && account !== "ANON" ? account : null;
  }

  /** The share's dots (b/s/h letters) from a saved history, or null if it can't be read. */
  function gridFrom(history) {
    if (!Array.isArray(history)) return null;
    const letters = history.map((h) => LETTER[String(h?.t ?? "").toUpperCase()]);
    if (letters.some((c) => !c) || letters.length > MAX_TILES) return null;
    return letters.join("");
  }

  /** A finished game has exactly one spangram and at least one theme word. */
  function isFinished(grid) {
    return grid.split("s").length - 1 === 1 && grid.replace(/h/g, "").length >= 2;
  }

  /**
   * Finished, non-archive games from NYT's saved state.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries) {
    const byPuzzle = new Map();
    for (const [key, value] of entries) {
      if (!STATE_KEY.test(key)) continue;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      for (const state of Array.isArray(parsed?.states) ? parsed.states : []) {
        const data = state?.data;
        if (!data || data.isPlayingArchive === true || data.isSolved !== true) continue;
        if (!DATE.test(state.printDate ?? "")) continue;
        const grid = gridFrom(data.history);
        if (!grid || !isFinished(grid)) continue;
        const puzzle = String(numberFromPrintDate(state.printDate));
        const account = accountOf(key);
        const signedIn = account !== null;
        // A signed-in save wins over a signed-out one for the same puzzle.
        if (byPuzzle.get(puzzle)?.signedIn && !signedIn) continue;
        byPuzzle.set(puzzle, { signedIn, account, puzzle, printDate: state.printDate, grid });
      }
    }
    return [...byPuzzle.values()];
  }

  function toResult(game) {
    const found = game.grid.replace(/h/g, "");
    return {
      puzzle: game.puzzle,
      hints: game.grid.length - found.length,
      words: found.length,
      spangram: found.indexOf("s") + 1,
      grid: game.grid,
    };
  }

  /** Like NYT's share (without the theme): four dots to a row. */
  function shareText(result) {
    const dots = Array.from(result.grid, (c) => EMOJI[c]);
    const rows = [];
    for (let i = 0; i < dots.length; i += 4) rows.push(dots.slice(i, i + 4).join(""));
    return `Strands #${Number(result.puzzle).toLocaleString("en-US")}\n${rows.join("\n")}`;
  }

  function formatScore(result) {
    // Same as the site: "⭐" for no hints, "2💡" for two.
    return result.hints === 0 ? "⭐" : `${result.hints}💡`;
  }

  const api = { numberFromPrintDate, accountOf, gridFrom, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimStrands = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
