// Pure Costcodle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From costcodle.com's code (checked 2026-11-23), Checkout mode keeps today's
// game in localStorage "checkoutState": { gameNumber, rounds: [{ name, short,
// guessCents, actualCents, diffCents }], phase: "guessing" | "awaitingNext" |
// "complete" }, and finished days in "checkoutStats".history[gameNumber] with
// the same rounds. Its own day numbers start at 2 on 2023-09-21 (local date);
// Checkout #1 is its day 1,148. Classic mode ("state", "stats") is ignored.
// There are no accounts.
(function (root) {
  const EPOCH_UTC = Date.UTC(2026, 10, 9); // Checkout #0
  const DAY_MS = 86400000;
  const FIRST_DAY = 1148; // Costcodle's own number for Checkout #1
  const ITEMS = 5;
  const MAX_OFF_CENTS = 1000000000;

  /** "2026-11-23" -> 14. */
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

  /** The five rounds' misses, or null if they aren't a finished, possible game. */
  function offsOf(rounds) {
    if (!Array.isArray(rounds) || rounds.length !== ITEMS) return null;
    const offs = [];
    for (const r of rounds) {
      const off = r?.diffCents;
      if (!Number.isInteger(off) || off < 0 || off > MAX_OFF_CENTS) return null;
      if (Number.isInteger(r.guessCents) && Number.isInteger(r.actualCents) && Math.abs(r.guessCents - r.actualCents) !== off) {
        return null;
      }
      offs.push(off);
    }
    return offs;
  }

  /**
   * Finished Checkout games from today's or yesterday's puzzle (`today` is
   * its Checkout number), newest first. Older ones are archive games.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const get = (key) => parse(entries.find(([k]) => k === key)?.[1]);
    const found = new Map();
    const add = (gameNumber, rounds) => {
      const puzzle = Number(gameNumber) - FIRST_DAY + 1;
      if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today || found.has(puzzle)) return;
      const offs = offsOf(rounds);
      if (!offs) return;
      found.set(puzzle, {
        puzzle: String(puzzle),
        offs,
        names: rounds.map((r) => String(r.short || r.name || "Item")),
      });
    };
    const state = get("checkoutState");
    if (state?.phase === "complete") add(state.gameNumber, state.rounds);
    for (const [n, entry] of Object.entries(get("checkoutStats")?.history ?? {})) add(n, entry?.rounds);
    return [...found.values()].sort((a, b) => Number(b.puzzle) - Number(a.puzzle));
  }

  function toResult(g) {
    return { puzzle: g.puzzle, offs: g.offs, total: g.offs.reduce((s, c) => s + c, 0), names: g.names };
  }

  const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(cents) {
    return `$${usd.format(cents / 100)}`;
  }

  /** Laid out like costcodle.com's own share text. */
  function shareText(result) {
    const names = result.names ?? result.offs.map(() => "Item");
    return [
      `I played today's Costcodle with a total off of ${money(result.total)}!`,
      "",
      `Costcodle Checkout #${result.puzzle}`,
      ...result.offs.map((c, i) => `${i + 1}. ${names[i]} — off ${money(c)}`),
      "",
      "Play now at https://www.costcodle.com",
    ].join("\n");
  }

  function formatScore(result) {
    return money(result.total);
  }

  const api = { numberFromDate, findFinishedGames, toResult, shareText, formatScore, money };
  root.ScrimCostcodle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
