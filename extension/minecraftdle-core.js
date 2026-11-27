// Pure Minecraftdle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From minecraftdle.com's code (checked 2026-11-26): the daily is played on
// its server; each mode's state is cached in localStorage
// "minecraftdle:daily:<blocks|items|mobs>" as { day: "YYYY-MM-DD" (Madrid),
// number, status: "new" | "playing" | "won", guesses: [{ name, states }],
// ... }, where states has one of correct / incorrect / higher / lower per
// column (the first is the name itself). The daily can't be lost: guesses are
// unlimited. #1 was 2026-11-10; the day changes at midnight in Madrid. Only
// the states are sent, not the names. No accounts are read.
(function (root) {
  const EPOCH_UTC = Date.UTC(2026, 10, 9); // #0
  const DAY_MS = 86400000;
  const MAX_GUESSES = 999;
  const MODES = [
    { game: "minecraftdle", path: "blocks", noun: "Block" },
    { game: "minecraftdleitem", path: "items", noun: "Item" },
    { game: "minecraftdlemob", path: "mobs", noun: "Mob" },
  ];
  const STATES = { correct: "c", incorrect: "x", higher: "u", lower: "d" };

  /** "YYYY-MM-DD" in Madrid at `ms`. */
  function madridDate(ms) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ms));
  }

  /** "2026-11-27" -> 18. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /**
   * Each mode's daily, if it's won and from today's or yesterday's puzzle
   * (`today` is today's number). `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const out = [];
    for (const mode of MODES) {
      let s;
      try {
        s = JSON.parse(entries.find(([k]) => k === `minecraftdle:daily:${mode.path}`)?.[1] ?? "null");
      } catch {
        continue;
      }
      if (!s || s.status !== "won" || !Array.isArray(s.guesses)) continue;
      const puzzle = Number(s.number);
      if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today) continue;
      if (typeof s.day === "string" && numberFromDate(s.day) !== puzzle) continue;
      const grid = s.guesses.map((g) =>
        Array.isArray(g?.states) ? g.states.slice(1).map((st) => STATES[st] ?? "?").join("") : "?",
      );
      if (grid.length === 0 || grid.length > MAX_GUESSES || grid.some((r) => !/^[cxud]{1,12}$/.test(r))) continue;
      // The answer itself is the guess whose name is right. Other guesses can
      // have every trait right too, so their rows (name left out) are all green as well.
      if (!s.guesses.some((g) => g?.states?.[0] === "correct")) continue;
      out.push({ game: mode.game, puzzle: String(puzzle), guesses: grid.length, grid, streak: s.stats?.currentStreak });
    }
    return out;
  }

  function toResult(g) {
    return { puzzle: g.puzzle, guesses: g.guesses, grid: g.grid };
  }

  const SQUARES = { c: "🟩", x: "🟥", u: "⬆️", d: "⬇️" };

  /** Same layout as Minecraftdle's own share. */
  function shareText(game, result) {
    const mode = MODES.find((m) => m.game === game);
    const rows = result.grid.slice(0, 10).map((row) => Array.from(row, (c) => SQUARES[c]).join(""));
    const more = result.grid.length > 10 ? [`… +${result.grid.length - 10}`] : [];
    const tries = `${result.guesses} ${result.guesses === 1 ? "try" : "tries"}`;
    return [`Minecraftdle #${result.puzzle} · ${mode.noun}`, tries, ...rows, ...more, `https://minecraftdle.com/${mode.path}`].join(
      "\n",
    );
  }

  function formatScore(result) {
    return String(result.guesses);
  }

  const api = { MODES, madridDate, numberFromDate, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimMinecraftdle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
