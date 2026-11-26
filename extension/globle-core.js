// Pure Globle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From globle-game.com's code (checked 2026-11-26): today's game is in
// localStorage "guesses": { countries: [names], day: "YYYY-MM-DD" } (local
// date), and "statistics": { lastWin: "YYYY-MM-DD", usedGuesses: [n, ...],
// ... }, where a win adds that day's guess count to usedGuesses. Guesses are
// unlimited, so a game is over once it's won. Globle has no puzzle numbers:
// Scrim numbers its days from 2022-01-01. No accounts are read.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 0, 1);
  const DAY_MS = 86400000;
  const MAX_GUESSES = 199;

  /** "2026-11-26" -> 1790. */
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

  /**
   * Today's game, if it's won (`today` is "YYYY-MM-DD"). Only today's: the
   * save keeps no other days. `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const get = (key) => parse(entries.find(([k]) => k === key)?.[1]);
    const game = get("guesses");
    const stats = get("statistics");
    if (!game || !stats || game.day !== today || String(stats.lastWin).slice(0, 10) !== today) return [];
    const used = Array.isArray(stats.usedGuesses) ? stats.usedGuesses : [];
    const guesses = Number(used[used.length - 1]);
    if (!Number.isInteger(guesses) || guesses < 1 || guesses > MAX_GUESSES) return [];
    return [{ puzzle: String(numberFromDate(today)), guesses, day: today }];
  }

  function toResult(g) {
    return { puzzle: g.puzzle, guesses: g.guesses };
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** The parts of Globle's share that Scrim reads: the date and "= guesses". */
  function shareText(result) {
    const d = new Date(EPOCH_UTC + Number(result.puzzle) * DAY_MS);
    const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    return `🌎 ${date} 🌍\n🟩 = ${result.guesses}\n\nhttps://globle-game.com\n#globle`;
  }

  function formatScore(result) {
    return String(result.guesses);
  }

  const api = { numberFromDate, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimGloble = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
