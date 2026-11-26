// Pure Contexto helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From contexto.me's code (checked 2026-11-23): games are kept in localStorage
// under "contexto-games-<language>" (Scrim reads "en" only):
// { "<gameId>": { gameId, guessHistory: [{ word, distance }], foundWord,
// numberOfTips, numberOfAttempts, gaveUp, ... } }. A game is over once
// foundWord or gaveUp is set (gaveUp holds the secret word). Signing in is
// optional; it's Firebase Auth, so the account's uid is in IndexedDB (see
// contexto.js). The save itself isn't per account.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 8, 18); // Contexto (English) #0 was 2022-09-18
  const DAY_MS = 86400000;
  const KEY = "contexto-games-en";
  const MAX_GUESSES = 9999;

  /** "2026-11-23" -> 1527. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /** "1527" -> "11/23/2026", as Contexto's English share writes it. */
  function shareDate(puzzle) {
    const d = new Date(EPOCH_UTC + Number(puzzle) * DAY_MS);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
  }

  /**
   * [green, yellow, red]: guesses closer than 300, closer than 1,500, further
   * (as the share counts them). Hints are in the history too, marked
   * `hint: true`, but numberOfAttempts leaves them out, so the bars do as well.
   */
  function chartOf(history) {
    const chart = [0, 0, 0];
    for (const g of history) {
      if (!Array.isArray(g) && g?.hint) continue;
      const distance = Array.isArray(g) ? g[1] : g?.distance;
      if (typeof distance !== "number") continue;
      chart[distance < 300 ? 0 : distance < 1500 ? 1 : 2] += 1;
    }
    return chart;
  }

  /**
   * Finished daily games from today's or yesterday's puzzle (`today` is its
   * number), newest first. Older ones are archive games, which don't count.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today, account = null) {
    const raw = entries.find(([key]) => key === KEY)?.[1];
    if (!raw) return [];
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      return [];
    }
    const games = [];
    for (const [id, g] of Object.entries(saved ?? {})) {
      const puzzle = Number(id);
      if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today || !g) continue;
      if (!g.foundWord && !g.gaveUp) continue;
      const guesses = Number(g.numberOfAttempts) || 0;
      if (guesses < 1 || guesses > MAX_GUESSES) continue;
      games.push({
        puzzle: String(puzzle),
        solved: Boolean(g.foundWord) && !g.gaveUp,
        guesses,
        hints: Math.min(Number(g.numberOfTips) || 0, guesses),
        chart: chartOf(Array.isArray(g.guessHistory) ? g.guessHistory : []),
        account,
      });
    }
    return games.sort((a, b) => Number(b.puzzle) - Number(a.puzzle));
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, guesses: g.guesses, hints: g.hints, chart: g.chart };
  }

  /** Same layout as contexto.me's own share text (the bars are scaled roughly the same way). */
  function shareText(result) {
    const verb = result.solved ? "and got it" : "but I gave up";
    const hints = result.hints > 0 ? ` and ${result.hints} hints` : "";
    const total = result.chart.reduce((s, n) => s + n, 0);
    const most = Math.max(...result.chart);
    const width = most <= 25 ? 5 : most <= 50 ? 10 : most <= 100 ? 15 : 20;
    const bars = result.chart.map((n, i) => {
      const len = total ? Math.min(n, Math.max(n > 0 ? 1 : 0, Math.round((n / total) * width))) : 0;
      return `${["🟩", "🟨", "🟥"][i].repeat(len)} ${n}`;
    });
    return `I played contexto.me ${shareDate(result.puzzle)} ${verb} in ${result.guesses} guesses${hints}.\n\n${bars.join("\n")}`;
  }

  function formatScore(result) {
    // Hints aren't shown: they're already counted in the guesses.
    return result.solved ? String(result.guesses) : "DNF";
  }

  const api = { numberFromDate, shareDate, chartOf, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimContexto = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
