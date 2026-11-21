// Pure Connections helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
//
// From NYT's Connections code (checked 2026-11-19): progress is saved in
// localStorage under "games-state-connections/<regiId|ANON>" (or
// "games-state-connections-collection/…") as { puzzleId, printDate, data }
// entries, where data is
//   { puzzleComplete, puzzleWon, mistakes, guesses, solvedCategories, isPlayingArchive }.
// Each guess is { cards: "3,7,12,15", correct } - the cards are the puzzle's
// card positions, not colours. Colours come from the day's puzzle: a card's
// level is the index of its category (0 yellow, 1 green, 2 blue, 3 purple).
// The state is only saved when a guess is made, so `puzzleComplete` may still
// be false after the last group; the guesses decide whether the game is over.
(function (root) {
  const EPOCH_UTC = Date.UTC(2023, 5, 11); // Connections #1 was 2023-06-12
  const DAY_MS = 86400000;
  const STATE_KEY = /^games-state-connections/;
  const GROUPS = 4;
  const MAX_MISTAKES = 4;
  const COLOURS = ["y", "g", "b", "p"];
  const EMOJI = { y: "🟨", g: "🟩", b: "🟦", p: "🟪" };

  /** "2024-07-18" -> 403. */
  function numberFromPrintDate(printDate) {
    const [y, m, d] = printDate.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  function localDate(now) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /** Visit every object in a parsed JSON value, passing the nearest printDate above it. */
  function walk(node, printDate, visit, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return;
    const date =
      typeof node.printDate === "string" && node.printDate
        ? node.printDate
        : typeof node.print_date === "string" && node.print_date
          ? node.print_date
          : printDate;
    visit(node, date);
    for (const value of Array.isArray(node) ? node : Object.values(node)) walk(value, date, visit, depth + 1);
  }

  /** NYT saves under ".../<regiId>" when signed in and ".../ANON" when not. */
  function isSignedInKey(key) {
    const account = key.split("/")[1] ?? "";
    return account !== "" && account !== "ANON";
  }

  /** A guess's cards as a list of position strings, whatever form they were saved in. */
  function cardIds(cards) {
    const list = typeof cards === "string" ? cards.split(",") : Array.isArray(cards) ? cards : [];
    return list
      .map((c) => (c && typeof c === "object" ? (c.originalPosition ?? c.position) : c))
      .map((c) => String(c).trim())
      .filter((c) => c !== "" && c !== "undefined");
  }

  /**
   * Finished, non-archive games from NYT's saved state.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries, now = new Date()) {
    const byPuzzle = new Map();
    for (const [key, value] of entries) {
      if (!STATE_KEY.test(key)) continue;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      walk(parsed, null, (data, printDate) => {
        if (!Array.isArray(data.guesses) || !("puzzleWon" in data || "solvedCategories" in data)) return;
        if (data.isPlayingArchive === true) return;
        const correct = data.guesses.filter((g) => g?.correct === true).length;
        const wrong = data.guesses.filter((g) => g?.correct === false).length;
        const solved = data.puzzleWon === true || correct >= GROUPS;
        const over = solved || wrong >= MAX_MISTAKES || data.puzzleComplete === true;
        if (!over) return;
        const date = printDate || localDate(now);
        const puzzle = String(numberFromPrintDate(date));
        const signedIn = isSignedInKey(key);
        // A signed-in save wins over a signed-out one for the same puzzle.
        if (byPuzzle.get(puzzle)?.signedIn && !signedIn) return;
        byPuzzle.set(puzzle, {
          signedIn,
          puzzle,
          printDate: date,
          solved,
          mistakes: wrong || (Number.isInteger(data.mistakes) ? data.mistakes : 0),
          groups: Math.max(correct, Array.isArray(data.solvedCategories) ? data.solvedCategories.length : 0),
          guesses: data.guesses,
          solvedCategories: Array.isArray(data.solvedCategories) ? data.solvedCategories : [],
        });
      });
    }
    return [...byPuzzle.values()];
  }

  /**
   * Card position -> level from NYT's puzzle file (svc/connections/v2/<date>.json):
   * { categories: [{ title, cards: [{ content, position }] }] }, categories in
   * level order.
   */
  function levelsFromPuzzle(puzzle) {
    const levels = new Map();
    const categories = Array.isArray(puzzle?.categories) ? puzzle.categories : [];
    if (categories.length !== GROUPS) return levels;
    categories.forEach((cat, level) => {
      for (const card of Array.isArray(cat?.cards) ? cat.cards : []) {
        if (card?.position !== undefined) levels.set(String(card.position), level);
      }
    });
    return levels;
  }

  /** guesses -> ["yyyy", "gbgg", ...], or null when the colours can't be worked out. */
  function gridFromGuesses(guesses, levels = new Map(), solvedCategories = []) {
    const map = new Map(levels);
    // Solved groups carry their own level, which covers correct guesses at least.
    for (const cat of solvedCategories) {
      if (!Number.isInteger(cat?.level)) continue;
      for (const id of cardIds(cat.cards)) if (!map.has(id)) map.set(id, cat.level);
    }
    const grid = [];
    for (const guess of guesses) {
      const ids = cardIds(guess?.cards);
      if (ids.length !== 4) return null;
      const row = ids.map((id) => COLOURS[map.get(id)]);
      if (row.some((c) => !c)) return null;
      // A correct guess is one whole group, and a wrong one never is.
      if ((guess.correct === true) !== row.every((c) => c === row[0])) return null;
      grid.push(row.join(""));
    }
    return grid.length ? grid : null;
  }

  /** Score a grid the way Scrim's server does; null if it isn't a finished game. */
  function scoreGrid(grid) {
    if (grid.length > 7) return null;
    const isGroup = (r) => r === r[0].repeat(4);
    const found = grid.filter(isGroup);
    if (new Set(found).size !== found.length) return null;
    const mistakes = grid.length - found.length;
    const solved = found.length === GROUPS;
    const lastIsGroup = isGroup(grid[grid.length - 1]);
    if (solved ? mistakes > 3 || !lastIsGroup : mistakes !== MAX_MISTAKES || lastIsGroup) return null;
    return { solved, mistakes, groups: found.length };
  }

  /**
   * Build a Scrim ConnectionsResult. Includes the colour grid when it can be
   * worked out and agrees with the outcome; otherwise just the score.
   */
  function toResult(game, levels) {
    const grid = gridFromGuesses(game.guesses, levels, game.solvedCategories);
    const scored = grid && scoreGrid(grid);
    if (scored && scored.solved === game.solved) return { puzzle: game.puzzle, ...scored, grid };

    if (game.solved) {
      const mistakes = Math.min(3, Math.max(0, game.mistakes ?? 0));
      return { puzzle: game.puzzle, solved: true, mistakes, groups: GROUPS };
    }
    const groups = Math.min(3, Math.max(0, game.groups ?? 0));
    return { puzzle: game.puzzle, solved: false, mistakes: MAX_MISTAKES, groups };
  }

  function shareText(result) {
    const header = `Connections\nPuzzle #${Number(result.puzzle).toLocaleString("en-US")}`;
    if (!result.grid) return header;
    return `${header}\n${result.grid.map((r) => Array.from(r, (c) => EMOJI[c]).join("")).join("\n")}`;
  }

  function formatScore(result) {
    // Same as the site: "⭐" for no mistakes, "1❌" to "3❌" for mistakes, "💀" on the fourth.
    if (!result.solved) return "💀";
    return result.mistakes === 0 ? "⭐" : `${result.mistakes}❌`;
  }

  const api = {
    numberFromPrintDate,
    isSignedInKey,
    findFinishedGames,
    levelsFromPuzzle,
    gridFromGuesses,
    toResult,
    shareText,
    formatScore,
  };
  root.ScrimConnections = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
