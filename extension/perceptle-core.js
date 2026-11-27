// Pure Perceptle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From perceptle.com's code (checked 2026-11-26): a finished day is saved in
// localStorage "perceptle:YYYY-MM-DD" (the player's local date) as
// { v: 1, date, puzzle, total, grade, events: [{ id, score, grade, human }] },
// five events in the order count, predict, level, tempo, split, each 0–100;
// total is their average, rounded. Nothing is saved until all five are done,
// and practice rounds aren't saved. #1 was 2026-07-18. No accounts are read.
(function (root) {
  const EPOCH_UTC = Date.UTC(2026, 6, 17); // #0
  const DAY_MS = 86400000;
  const EVENTS = ["count", "predict", "level", "tempo", "split"];
  const EMOJI = ["🔢", "🎯", "📐", "🥁", "✂️"];

  /** "2026-11-26" -> 132. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /** Perceptle's letter for a score. */
  function grade(score) {
    return score >= 95 ? "S" : score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  }

  /**
   * Today's finished game, if there is one (`today` is "YYYY-MM-DD").
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const raw = entries.find(([k]) => k === `perceptle:${today}`)?.[1];
    let s;
    try {
      s = JSON.parse(raw ?? "null");
    } catch {
      return [];
    }
    if (!s || s.v !== 1 || s.date !== today || !Array.isArray(s.events) || s.events.length !== EVENTS.length) return [];
    const puzzle = numberFromDate(today);
    if (Number(s.puzzle) !== puzzle) return [];
    const events = EVENTS.map((id) => s.events.find((e) => e && e.id === id)?.score);
    if (events.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return [];
    return [{ puzzle: String(puzzle), events }];
  }

  function toResult(g) {
    const total = Math.round(g.events.reduce((sum, n) => sum + n, 0) / g.events.length);
    return { puzzle: g.puzzle, total, events: g.events };
  }

  /** Same layout as Perceptle's own share (without the Friday 🃏, which Scrim doesn't need). */
  function shareText(result) {
    const scores = result.events.map((n, i) => `${EMOJI[i]} ${n}`).join("  ");
    return `Perceptle #${result.puzzle} - ${grade(result.total)} (${result.total})\n${scores}\nhttps://perceptle.com`;
  }

  function formatScore(result) {
    return `${result.total} ${grade(result.total)}`;
  }

  const api = { numberFromDate, grade, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimPerceptle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
