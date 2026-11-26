// Pure Waffle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From wafflegame.net's code (checked 2026-11-26): the daily in progress or
// done is in localStorage "state": { gameNumber, puzzle: [21 letters],
// solution: [21 letters], swapsRemaining, ... }. It's solved once puzzle
// matches solution; the swaps left (at most 5) are its stars. Out of swaps
// unsolved is a loss. One puzzle worldwide, changing at midnight UTC; #0 was
// 2022-01-21. Deluxe and Royale are saved under other keys and ignored. The
// solution itself is never sent anywhere, only whether it was reached. No
// accounts are read.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 0, 21);
  const DAY_MS = 86400000;
  const KEY = "state";
  const TILES = 21;
  const MAX_STARS = 5;

  /** Today's Waffle number at `ms` (UTC date). */
  function numberAt(ms) {
    const d = new Date(ms);
    return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH_UTC) / DAY_MS);
  }

  /**
   * The saved daily, if it's over and from today's or yesterday's puzzle
   * (`today` is its number). `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    let s;
    try {
      s = JSON.parse(entries.find(([k]) => k === KEY)?.[1] ?? "null");
    } catch {
      return [];
    }
    if (!s || !Array.isArray(s.puzzle) || !Array.isArray(s.solution)) return [];
    if (s.puzzle.length !== TILES || s.solution.length !== TILES) return [];
    const puzzle = Number(s.gameNumber);
    if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today) return [];
    const swaps = Number(s.swapsRemaining);
    if (!Number.isInteger(swaps) || swaps < 0) return [];
    const solved = s.puzzle.join("") === s.solution.join("");
    if (!solved && swaps > 0) return [];
    return [{ puzzle: String(puzzle), solved, stars: solved ? Math.min(swaps, MAX_STARS) : null }];
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, stars: g.stars };
  }

  /** The first line of Waffle's share, which is all Scrim reads. */
  function shareText(result) {
    return `#waffle${result.puzzle} ${result.solved ? result.stars : "X"}/5\n\nwafflegame.net`;
  }

  function formatScore(result) {
    return result.solved ? `${result.stars}⭐` : "X";
  }

  const api = { numberAt, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimWaffle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
