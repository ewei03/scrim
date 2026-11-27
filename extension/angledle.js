// Runs on angledle.com. Watches the saved daily Guess; when it's over, sends
// the result to the background worker for submission.
(function () {
  const today = () => ScrimAngledle.numberAt(Date.now());

  ScrimContent.watch({
    game: "angledle",
    find: () => ScrimAngledle.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.solved}:${g.guesses}`,
    toResult: ScrimAngledle.toResult,
    shareText: ScrimAngledle.shareText,
    label: (r) => `Angledle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimAngledle.formatScore,
    today: () => String(today()),
    // Let the last guess's reveal finish first.
    delayMs: 1500,
  });
})();
