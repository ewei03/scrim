// Runs on nytimes.com/games/wordle. Watches NYT's saved game state; when a
// game finishes, sends the result to the background worker for submission.
(function () {
  function readTileRows() {
    return [...document.querySelectorAll('[role="group"][aria-label^="Row"]')].map((row) =>
      [...row.querySelectorAll('[data-testid="tile"]')].map((t) => t.dataset.state),
    );
  }

  /** The board's tiles, with their letters. */
  function readBoard() {
    return [...document.querySelectorAll('[role="group"][aria-label^="Row"]')].map((row) =>
      [...row.querySelectorAll('[data-testid="tile"]')].map((t) => ({
        state: t.dataset.state,
        letter: (t.textContent ?? "").trim(),
      })),
    );
  }

  // In a tab the extension opened to check for games played elsewhere, a
  // finished game may open on its results screen, with the board behind an
  // "Admire puzzle" button. Show the board so it can be read. (Tabs the player
  // opened are left alone.)
  let checkTab = null;
  chrome.runtime
    .sendMessage({ type: "is-check-tab" })
    .then((reply) => (checkTab = reply?.ok === true && reply.checkTab === true))
    .catch(() => (checkTab = false));
  function showBoard() {
    if (!checkTab || readBoard().some((row) => row.length)) return;
    const admire = [...document.querySelectorAll("button")].find((b) => /admire puzzle/i.test(b.textContent ?? ""));
    admire?.click();
  }

  let warned = false;
  ScrimContent.watch({
    game: "wordle",
    find: () => {
      const entries = Object.entries(localStorage);
      const saved = ScrimWordle.findFinishedGames(entries);
      // Finished on another device: NYT shows it, but may not save it here.
      showBoard();
      const today = ScrimContent.localDate();
      const rows = readBoard();
      const board = ScrimWordle.findBoardGame(entries, rows, today);
      // The board looks won but neither the save nor the board check counts it:
      // usually no save for today in this browser, which is what says whose game it is.
      const looksWon = rows.some((r) => r.length === 5 && r.every((t) => t.state === "correct"));
      if (looksWon && !board && !saved.some((g) => g.printDate === today) && !warned) {
        warned = true;
        console.debug("[Scrim] wordle: the board is finished, but there's no save for today here", {
          keys: entries.map(([k]) => k).filter((k) => k.startsWith("games-state-wordle")),
        });
      }
      return board ? [...saved, board] : saved;
    },
    key: (g) => `${g.puzzle}:${g.guesses.join(",")}`,
    toResult: (g) => ScrimWordle.toResult(g, readTileRows()),
    shareText: ScrimWordle.shareText,
    label: (r) => `Wordle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: (r) => `${r.solved ? r.guesses : "X"}/6`,
    delayMs: 2500, // let the tile flip animation finish
    today: () => String(ScrimWordle.numberFromPrintDate(ScrimContent.localDate())),
  });
})();
