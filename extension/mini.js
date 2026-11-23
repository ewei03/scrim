// Runs on minicrossword.com. Watches the saved Easy daily; when it's solved,
// sends the result to the background worker for submission.
(function () {
  const today = () => ScrimMini.numberFromDate(ScrimContent.localDate());

  ScrimContent.watch({
    game: "minicrossword",
    find: () => ScrimMini.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.seconds}:${g.reveals}`,
    toResult: ScrimMini.toResult,
    shareText: ScrimMini.shareText,
    label: (r) => `Mini Crossword #${r.puzzle}`,
    score: ScrimMini.formatScore,
    today: () => String(today()),
  });
})();
