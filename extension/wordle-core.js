// Pure Wordle helpers shared by the content script and the tests.
// Loaded as a classic content script, so it exposes a global.
(function (root) {
  const EPOCH_UTC = Date.UTC(2021, 5, 19); // Wordle #0
  const DAY_MS = 86400000;
  const STATE_KEY = /^games-state-wordleV2\//;
  const TILE_STATE = { correct: "g", present: "y", absent: "." };
  const EMOJI = { g: "🟩", y: "🟨", ".": "⬛" };

  /** "2026-11-19" -> 1979. NYT's own puzzleId is a different, internal number. */
  function numberFromPrintDate(printDate) {
    const [y, m, d] = printDate.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  }

  /**
   * Finished, non-archive games from NYT's saved state.
   * `entries` is [key, value][] from localStorage.
   */
  function findFinishedGames(entries) {
    const games = [];
    for (const [key, value] of entries) {
      if (!STATE_KEY.test(key)) continue;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      for (const state of parsed?.states ?? []) {
        const data = state?.data;
        if (!data || !state.printDate) continue;
        if (data.status !== "WIN" && data.status !== "FAIL") continue;
        if (data.isPlayingArchive) continue;
        const guesses = (data.boardState ?? []).filter((w) => typeof w === "string" && w.length === 5);
        games.push({
          signedIn: isSignedInKey(key),
          account: accountOf(key),
          puzzle: String(numberFromPrintDate(state.printDate)),
          printDate: state.printDate,
          solved: data.status === "WIN",
          guesses,
          hardMode: Boolean(data.hardMode),
        });
      }
    }
    return games;
  }

  /**
   * Today's game as finished on the board, when NYT's save here doesn't say so.
   *
   * Signed in, NYT loads a game finished on another device (e.g. a phone) from
   * its server and shows it, but this browser's save can stay "IN_PROGRESS".
   * The board is then the only place the result is.
   *
   * `entries` is [key, value][] from localStorage, `rows` the board's rows of
   * tiles ({ state: data-state, letter }), `today` today's print date. Only
   * trusted when this browser has a save for today's (non-archive) puzzle, which
   * says whose game it is; null otherwise, or when the board isn't finished.
   */
  function findBoardGame(entries, rows, today) {
    if (findFinishedGames(entries).some((g) => g.printDate === today)) return null; // the save has it
    let save = null;
    for (const [key, value] of entries) {
      if (!STATE_KEY.test(key)) continue;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      const state = (parsed?.states ?? []).find((s) => s?.printDate === today && s.data && !s.data.isPlayingArchive);
      // A signed-in save wins over a signed-out one.
      if (state && (!save || (!save.signedIn && isSignedInKey(key)))) {
        save = { signedIn: isSignedInKey(key), account: accountOf(key), hardMode: Boolean(state.data.hardMode) };
      }
    }
    if (!save) return null;

    const guesses = [];
    let solved = false;
    for (const row of rows) {
      if (row.length !== 5 || !row.every((t) => t.state in TILE_STATE)) break;
      const word = row.map((t) => t.letter).join("").toLowerCase();
      if (!/^[a-z]{5}$/.test(word)) return null;
      guesses.push(word);
      if (row.every((t) => t.state === "correct")) {
        solved = true;
        break;
      }
    }
    if (!solved && guesses.length < 6) return null;
    return { ...save, puzzle: String(numberFromPrintDate(today)), printDate: today, solved, guesses: guesses.slice(0, 6) };
  }

  /** NYT saves under ".../<regiId>" when signed in and ".../ANON" when not. */
  function isSignedInKey(key) {
    return accountOf(key) !== null;
  }

  /** The NYT account a save belongs to (its regiId), or null when signed out. */
  function accountOf(key) {
    const account = key.split("/")[1] ?? "";
    return account !== "" && account !== "ANON" ? account : null;
  }

  /** Standard Wordle colouring, including repeated letters. */
  function evaluate(guess, answer) {
    const out = Array(5).fill(".");
    const remaining = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) out[i] = "g";
      else remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] !== "g" && remaining[guess[i]] > 0) {
        out[i] = "y";
        remaining[guess[i]]--;
      }
    }
    return out.join("");
  }

  /** Board rows read from the page (arrays of tile data-state values) -> grid rows. */
  function gridFromTileStates(rows) {
    const grid = [];
    for (const row of rows) {
      if (row.length !== 5 || !row.every((s) => s in TILE_STATE)) break;
      grid.push(row.map((s) => TILE_STATE[s]).join(""));
    }
    return grid;
  }

  /** Build a Scrim WordleResult. Prefers the on-page grid; falls back to computing it for wins. */
  function toResult(game, tileRows) {
    const count = game.guesses.length;
    let grid = gridFromTileStates(tileRows ?? []);
    if (grid.length !== count && game.solved && count > 0) {
      const answer = game.guesses[count - 1];
      grid = game.guesses.map((g) => evaluate(g, answer));
    }
    const result = {
      puzzle: game.puzzle,
      solved: game.solved,
      guesses: game.solved ? count : null,
      hard: game.hardMode,
    };
    if (grid.length === count && count > 0) result.grid = grid;
    return result;
  }

  function shareText(result) {
    const score = `${result.solved ? result.guesses : "X"}/6${result.hard ? "*" : ""}`;
    const header = `Wordle ${Number(result.puzzle).toLocaleString("en-US")} ${score}`;
    if (!result.grid) return header;
    const rows = result.grid.map((r) => Array.from(r, (c) => EMOJI[c]).join(""));
    return `${header}\n\n${rows.join("\n")}`;
  }

  const api = { numberFromPrintDate, isSignedInKey, accountOf, findFinishedGames, findBoardGame, evaluate, gridFromTileStates, toResult, shareText };
  root.ScrimWordle = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
