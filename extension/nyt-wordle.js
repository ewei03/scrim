// Runs on nytimes.com/games/wordle. Watches NYT's saved game state; when a
// game finishes, sends the result to the background worker for submission.
(function () {
  function readTileRows() {
    return [...document.querySelectorAll('[role="group"][aria-label^="Row"]')].map((row) =>
      [...row.querySelectorAll('[data-testid="tile"]')].map((t) => t.dataset.state),
    );
  }

  ScrimContent.watch({
    game: "wordle",
    find: () => ScrimWordle.findFinishedGames(Object.entries(localStorage)),
    key: (g) => `${g.puzzle}:${g.guesses.join(",")}`,
    toResult: (g) => ScrimWordle.toResult(g, readTileRows()),
    shareText: ScrimWordle.shareText,
    label: (r) => `Wordle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: (r) => `${r.solved ? r.guesses : "X"}/6`,
    delayMs: 2500, // let the tile flip animation finish
    signInTo: "NYT",
    today: () => String(ScrimWordle.numberFromPrintDate(ScrimContent.localDate())),
  });
})();
