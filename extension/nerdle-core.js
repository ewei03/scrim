// Pure Nerdle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From nerdlegame.com's code (checked 2026-11-26): classic Nerdle's game is
// in localStorage "gameState": { guesses: ["12+35=47", ...], solution,
// gameMode: "", solutionIndex }, and the share calls it #solutionIndex + 1.
// Other modes on the same site set localStorage "gameMode" (and their saved
// gameMode) to something else; replays use "gameState_replay". One puzzle
// worldwide, changing at midnight UTC; #1 was 2022-02-03. The grid is worked
// out the way Nerdle colours it; the solution itself isn't sent. No accounts
// are read.
(function (root) {
  const EPOCH_UTC = Date.UTC(2022, 1, 2); // #0
  const DAY_MS = 86400000;
  const WIDTH = 8;
  const MAX_GUESSES = 6;

  /** Today's Nerdle number at `ms` (UTC date). */
  function numberAt(ms) {
    const d = new Date(ms);
    return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH_UTC) / DAY_MS);
  }

  /** "g" right place, "p" elsewhere in the answer, "." not in it (each answer character used once). */
  function rowOf(guess, solution) {
    const answer = Array.from(solution);
    const used = answer.map(() => false);
    const row = Array.from(guess).map(() => ".");
    Array.from(guess).forEach((c, i) => {
      if (c === answer[i]) {
        row[i] = "g";
        used[i] = true;
      }
    });
    Array.from(guess).forEach((c, i) => {
      if (row[i] === "g") return;
      const j = answer.findIndex((a, k) => a === c && !used[k]);
      if (j > -1) {
        row[i] = "p";
        used[j] = true;
      }
    });
    return row.join("");
  }

  /**
   * The saved classic game, if it's over and from today's or yesterday's
   * puzzle (`today` is its number). `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, today) {
    const get = (key) => entries.find(([k]) => k === key)?.[1];
    if ((get("gameMode") ?? "") !== "") return [];
    let s;
    try {
      s = JSON.parse(get("gameState") ?? "null");
    } catch {
      return [];
    }
    if (!s || (s.gameMode ?? "") !== "" || typeof s.solution !== "string" || s.solution.length !== WIDTH) return [];
    const index = Number(s.solutionIndex);
    if (!Number.isInteger(index)) return [];
    const puzzle = index + 1;
    if (puzzle < today - 1 || puzzle > today) return [];
    const guesses = Array.isArray(s.guesses) ? s.guesses.filter((g) => typeof g === "string" && g !== "") : [];
    if (guesses.length === 0 || guesses.length > MAX_GUESSES || guesses.some((g) => g.length !== WIDTH)) return [];
    const solved = guesses[guesses.length - 1] === s.solution;
    if (!solved && guesses.length < MAX_GUESSES) return [];
    if (guesses.slice(0, -1).includes(s.solution)) return [];
    return [{ puzzle: String(puzzle), solved, guesses: guesses.length, grid: guesses.map((g) => rowOf(g, s.solution)) }];
  }

  function toResult(g) {
    return { puzzle: g.puzzle, solved: g.solved, guesses: g.solved ? g.guesses : null, grid: g.grid };
  }

  const SQUARES = { g: "🟩", p: "🟪", ".": "⬛" };

  /** Same layout as Nerdle's own share. */
  function shareText(result) {
    const rows = result.grid.map((row) => Array.from(row, (c) => SQUARES[c]).join(""));
    return `nerdlegame ${result.puzzle} ${result.solved ? result.guesses : "X"}/6\n\n${rows.join("\n")}`;
  }

  function formatScore(result) {
    return `${result.solved ? result.guesses : "X"}/6`;
  }

  const api = { numberAt, rowOf, findFinishedGames, toResult, shareText, formatScore };
  root.ScrimNerdle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
