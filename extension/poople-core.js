// Pure Poople helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From poople.io's code (checked 2026-11-23): today's path is in localStorage
// "guesses", a JSON array of words starting with the day's word; the game is
// over once the last one is "poop". "dateLastPlayed" is when the page was last
// opened (ms); the path is thrown away when a new day's page opens. The
// shortest path isn't saved, only shown ("The best solution was N guesses."),
// so the content script reads it from the page. One puzzle worldwide, which
// changes at 08:00 UTC; #1 was 2025-08-15. There are no accounts.
(function (root) {
  const EPOCH_UTC = Date.UTC(2025, 7, 14); // #0
  const DAY_MS = 86400000;
  const RESET_MS = 8 * 3600000;
  const MAX_GUESSES = 99;

  /** The puzzle on at `ms` (a timestamp). */
  function numberAt(ms) {
    return Math.floor((ms - RESET_MS - EPOCH_UTC) / DAY_MS);
  }

  function parse(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** A row of the share per word: "p" where a letter matches POOP. */
  function rowOf(word) {
    return Array.from(word.toLowerCase(), (c, i) => (c === "poop"[i] ? "p" : ".")).join("");
  }

  /**
   * Today's finished game, if there is one (as a one-item list).
   * `entries` is [key, value][] from localStorage; `best` is the shortest
   * path shown on the page (null until it's shown); `now` a timestamp.
   */
  function findFinishedGames(entries, best, now) {
    const get = (key) => parse(entries.find(([k]) => k === key)?.[1]);
    const words = get("guesses");
    const opened = Number(get("dateLastPlayed"));
    if (!Array.isArray(words) || words.length < 2 || !Number.isFinite(opened)) return [];
    if (!words.every((w) => typeof w === "string" && /^[a-z]{4}$/i.test(w))) return [];
    if (words.at(-1).toLowerCase() !== "poop") return [];
    // A save from an earlier day that this page hasn't cleared yet.
    if (numberAt(opened) !== numberAt(now)) return [];
    const guesses = words.length - 1;
    if (guesses > MAX_GUESSES || !Number.isInteger(best) || best < 1 || best > guesses) return [];
    return [{ puzzle: String(numberAt(opened)), guesses, best, grid: words.map(rowOf) }];
  }

  /** "The best solution was 4 guesses." -> 4. */
  function bestFrom(text) {
    const m = /best solution was\s+(\d+)/i.exec(text ?? "");
    return m ? Number(m[1]) : null;
  }

  function toResult(g) {
    return { puzzle: g.puzzle, guesses: g.guesses, best: g.best, grid: g.grid };
  }

  /** The same as poople.io's own share text. */
  function shareText(result) {
    const rows = result.grid.map((row) => Array.from(row, (c) => (c === "p" ? "🟫" : "⬜")).join(""));
    return `Poople #${result.puzzle} ${result.guesses}/${result.best}\n${rows.join("\n")}\n\nhttps://poople.io/`;
  }

  function formatScore(result) {
    return result.guesses === result.best ? "⭐" : `${result.guesses}/${result.best}`;
  }

  const api = { numberAt, findFinishedGames, bestFrom, toResult, shareText, formatScore };
  root.ScrimPoople = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
