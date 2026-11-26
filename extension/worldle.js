// Runs on worldle.teuteuf.fr. Watches the saved daily country rounds; when
// one finishes, sends the result to the background worker for submission.
(function () {
  const today = () => ScrimWorldle.numberFromDate(ScrimContent.localDate());

  ScrimContent.watch({
    game: "worldle",
    find: () => ScrimWorldle.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.solved}:${g.guesses}`,
    toResult: ScrimWorldle.toResult,
    shareText: ScrimWorldle.shareText,
    label: (r) => `Worldle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimWorldle.formatScore,
    today: () => String(today()),
    // Let the last guess's animation finish before the notice shows.
    delayMs: 1500,
  });
})();
