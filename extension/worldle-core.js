// Pure Worldle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From worldle.teuteuf.fr's code (checked 2026-11-26): the main country
// round's guesses are in localStorage "guesses": { "<YYYY-MM-DD>": [{ name,
// distance (metres), direction }] }, by local date. A day is won when the
// last guess has distance 0, lost after six. Archive and bonus rounds are
// saved under other keys and ignored. #0 was 2022-01-21. The share draws each
// guess as five squares for its closeness: max(2e7 - distance, 0) / 2e7 as a
// whole percent, one green per 20% and a yellow for 10% more. Signing in is
// optional and the save isn't per account, so games count for this browser.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 0, 21);
  const DAY_MS = 86400000;
  const KEY = "guesses";
  const MAX_GUESSES = 6;
  const FAR = 2e7;

  /** "2026-11-26" -> 1770. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /** A guess's five squares: "ggggy", "g....", "ggggg" for the country. */
  function rowOf(distance) {
    const pct = Math.floor((Math.max(FAR - distance, 0) / FAR) * 100);
    const greens = Math.floor(pct / 20);
    const yellow = pct - greens * 20 >= 10 ? 1 : 0;
    return "g".repeat(greens) + "y".repeat(yellow) + ".".repeat(5 - greens - yellow);
  }

  /**
   * Finished games from today's or yesterday's puzzle (`today` is its number),
   * newest first. `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const raw = entries.find(([key]) => key === KEY)?.[1];
    let saved;
    try {
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      return [];
    }
    const games = [];
    for (const [day, guesses] of Object.entries(saved ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(guesses)) continue;
      const puzzle = numberFromDate(day);
      if (puzzle < today - 1 || puzzle > today) continue;
      const distances = guesses.map((g) => g?.distance);
      if (distances.length === 0 || distances.length > MAX_GUESSES) continue;
      if (distances.some((d) => typeof d !== "number" || !Number.isFinite(d) || d < 0)) continue;
      const solved = distances[distances.length - 1] === 0;
      if (!solved && distances.length < MAX_GUESSES) continue;
      // The country can only be guessed once, at the end.
      if (distances.slice(0, -1).includes(0)) continue;
      games.push({ puzzle: String(puzzle), solved, guesses: distances.length, grid: distances.map(rowOf) });
    }
    return games.sort((a, b) => Number(b.puzzle) - Number(a.puzzle));
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, guesses: g.solved ? g.guesses : null, grid: g.grid };
  }

  const SQUARES = { g: "🟩", y: "🟨", ".": "⬛" };

  /** Close to Worldle's own share (without the direction arrows, which aren't kept). */
  function shareText(result) {
    const rows = result.grid.map((row, i) => {
      const end = result.solved && i === result.grid.length - 1 ? "🎉" : "";
      return Array.from(row, (c) => SQUARES[c]).join("") + end;
    });
    return `#Worldle #${result.puzzle} ${result.solved ? result.guesses : "X"}/6\n${rows.join("\n")}\n\nhttps://worldle.teuteuf.fr`;
  }

  function formatScore(result) {
    return `${result.solved ? result.guesses : "X"}/6`;
  }

  const api = { numberFromDate, rowOf, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimWorldle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
