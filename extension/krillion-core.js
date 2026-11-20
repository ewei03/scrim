// Pure Krillion helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// krillion.io keeps finished Daily Dives in localStorage under
// "krillion:stats:v1" (or "krillion:account:<owner>:krillion:stats:v1" when
// signed in): { history: { "2026-11-19": { score, tiers: [tierId|"miss" ×7] } } }.
// The in-progress dive is "krillion:game:v1": { date, phase, results[{ tier, score }] }.
// Archive, Unlimited and pack dives use other keys and are ignored.
(function (root) {
  const EPOCH_UTC = Date.UTC(2026, 6, 15); // Krillion #1 was 2026-07-16 (New York)
  const DAY_MS = 86400000;
  const PROMPTS = 7;
  // Krillion's tier ids -> Scrim's one-letter codes (see src/games/krillion.ts).
  const TIER_CODE = { miss: "x", plankton: "p", tooclever: "c", schooler: "s", rare: "r", deepcut: "d", krillion: "k" };
  const POINTS = { x: 0, p: 10, c: 15, s: 30, r: 60, d: 85, k: 100 };
  const EMOJI = { x: "⬛", p: "🫧", c: "🤡", s: "🐟", r: "🦑", d: "🏮", k: "🌟" };
  const STATS_KEY = /(^|:)krillion:stats:v1$/;
  const GAME_KEY = /(^|:)krillion:game:v1$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** "2026-11-19" -> 127. */
  function numberFromDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  function tiersFrom(list) {
    if (!Array.isArray(list) || list.length !== PROMPTS) return null;
    const codes = list.map((t) => TIER_CODE[t ?? "miss"]);
    return codes.every(Boolean) ? codes.join("") : null;
  }

  function dive(date, tiers) {
    return { puzzle: String(numberFromDate(date)), date, tiers };
  }

  /**
   * Finished Daily Dives, newest first, limited to the `days` most recent dates.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedDives(entries, days = 2) {
    const byDate = new Map();
    for (const [key, value] of entries) {
      let parsed;
      if (!STATS_KEY.test(key) && !GAME_KEY.test(key)) continue;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      if (STATS_KEY.test(key)) {
        for (const [date, entry] of Object.entries(parsed?.history ?? {})) {
          const tiers = DATE.test(date) && tiersFrom(entry?.tiers);
          if (tiers) byDate.set(date, dive(date, tiers));
        }
      } else if (parsed?.phase === "done" && DATE.test(parsed?.date ?? "")) {
        const tiers = tiersFrom((parsed.results ?? []).map((r) => r?.tier ?? "miss"));
        if (tiers && !byDate.has(parsed.date)) byDate.set(parsed.date, dive(parsed.date, tiers));
      }
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
  }

  function toResult(d) {
    return { puzzle: d.puzzle, points: Array.from(d.tiers).reduce((s, c) => s + POINTS[c], 0), tiers: d.tiers };
  }

  /** Same layout as krillion.io's own share text. */
  function shareText(result) {
    return `Krillion #${result.puzzle} 🦐\n${result.points}\n\n${Array.from(result.tiers, (c) => EMOJI[c]).join("")}`;
  }

  function formatScore(result) {
    return result.points.toLocaleString("en-US");
  }

  const api = { numberFromDate, findFinishedDives, toResult, shareText, formatScore };
  root.ScrimKrillion = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
