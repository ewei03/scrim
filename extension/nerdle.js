// Runs on nerdlegame.com. Watches the saved classic game; when it's over,
// sends the result to the background worker for submission.
(function () {
  const today = () => ScrimNerdle.numberAt(Date.now());

  ScrimContent.watch({
    game: "nerdle",
    find: () => ScrimNerdle.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.solved}:${g.guesses}`,
    toResult: ScrimNerdle.toResult,
    shareText: ScrimNerdle.shareText,
    label: (r) => `Nerdle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimNerdle.formatScore,
    today: () => String(today()),
    delayMs: 1500,
  });
})();
