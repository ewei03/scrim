// Runs on nytimes.com/games/connections. Watches NYT's saved game state; when
// a game finishes, sends the result to the background worker for submission.
(function () {
  const puzzles = new Map();

  /** Card colours for a day's puzzle, from the same file the game loads. */
  async function levelsFor(printDate) {
    if (!puzzles.has(printDate)) {
      puzzles.set(
        printDate,
        fetch(`/svc/connections/v2/${printDate}.json`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then(ScrimConnections.levelsFromPuzzle)
          .catch(() => new Map()),
      );
    }
    return puzzles.get(printDate);
  }

  ScrimContent.watch({
    game: "connections",
    find: () => ScrimConnections.findFinishedGames(Object.entries(localStorage)),
    key: (g) => `${g.puzzle}:${g.solved}:${g.mistakes}:${g.groups}:${g.guesses.length}`,
    toResult: async (g) => ScrimConnections.toResult(g, await levelsFor(g.printDate)),
    shareText: ScrimConnections.shareText,
    label: (r) => `Connections #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimConnections.formatScore,
    delayMs: 1500, // let the last group's reveal finish saving
    today: () => String(ScrimConnections.numberFromPrintDate(ScrimContent.localDate())),
  });
})();
