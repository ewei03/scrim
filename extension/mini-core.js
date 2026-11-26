// Pure Mini Crossword helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From minicrossword.com's code (checked 2026-11-26): each daily in progress
// or done is in localStorage "crosswordMini_daily_daily-<level>" (easy, hard):
// { puzzleId: "mini-daily-<level>-<n>", elapsedMs, timerSeconds,
// revealedCells: [...], isComplete }. Archive plays are saved under other
// keys and ignored. Both are numbered from #1 on 2026-06-22, by local date. Signing in is optional (the
// user is cached in "heygg_user"); the save itself isn't per account.
(function (root) {
  const EPOCH_UTC = Date.UTC(2026, 5, 21); // #0
  const DAY_MS = 86400000;
  const ID = /^mini-daily-(easy|hard)-(\d+)$/;
  const MAX_SECONDS = 86400;
  const MAX_REVEALS = 49;

  /** "2026-11-23" -> 155. */
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

  /** The signed-in account's id, or null. */
  function accountOf(entries) {
    const user = parse(entries.find(([k]) => k === "heygg_user")?.[1]);
    const id = user?.id ?? user?.user_id ?? null;
    return id === null || id === undefined ? null : String(id);
  }

  /**
   * Today's or yesterday's finished daily at `level` ("easy" or "hard";
   * `today` is its number), as a list. `entries` is [key, value][] from
   * localStorage.
   */
  function findFinishedGames(entries, today, level = "easy") {
    const save = parse(entries.find(([k]) => k === `crosswordMini_daily_daily-${level}`)?.[1]);
    if (!save?.isComplete) return [];
    const m = ID.exec(String(save.puzzleId ?? ""));
    const puzzle = m && m[1] === level ? Number(m[2]) : NaN;
    if (!Number.isInteger(puzzle) || puzzle < today - 1 || puzzle > today) return [];
    const ms = Number.isFinite(save.elapsedMs)
      ? save.elapsedMs
      : Number.isFinite(save.timerSeconds)
        ? save.timerSeconds * 1000
        : null;
    if (ms === null) return [];
    const seconds = Math.floor(ms / 1000);
    const reveals = Array.isArray(save.revealedCells) ? save.revealedCells.length : 0;
    if (seconds < 0 || seconds > MAX_SECONDS || reveals > MAX_REVEALS) return [];
    return [{ puzzle: String(puzzle), seconds, reveals, account: accountOf(entries) }];
  }

  function toResult(g) {
    return { puzzle: g.puzzle, seconds: g.seconds, reveals: g.reveals };
  }

  /** 83 -> "1:23", 45 -> "45s", as the Mini writes times. */
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m === 0 ? `${s}s` : `${m}:${String(s).padStart(2, "0")}`;
  }

  /** Laid out like minicrossword.com's own share text (without the title and grid). */
  function shareText(result, level = "easy") {
    const reveals = result.reveals === 0 ? "No reveals!" : `Reveals: ${result.reveals}`;
    return `Mini Crossword ${level === "hard" ? "Hard" : "Easy"} #${result.puzzle}\n${formatTime(result.seconds)} | ${reveals}\n\nPlay free at minicrossword.com/`;
  }

  function formatScore(result) {
    return result.reveals ? `${formatTime(result.seconds)} +${result.reveals}💡` : formatTime(result.seconds);
  }

  const api = { numberFromDate, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimMini = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
