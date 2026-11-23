// Runs on nytimes.com/games/strands. Watches NYT's saved game state; when a
// game finishes, sends the result to the background worker for submission.
(function () {
  ScrimContent.watch({
    game: "strands",
    find: () => ScrimStrands.findFinishedGames(Object.entries(localStorage)),
    key: (g) => `${g.puzzle}:${g.grid}`,
    toResult: ScrimStrands.toResult,
    shareText: ScrimStrands.shareText,
    label: (r) => `Strands #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimStrands.formatScore,
    delayMs: 1500, // let the last word's reveal finish saving
    today: () => String(ScrimStrands.numberFromPrintDate(ScrimContent.localDate())),
  });
})();
