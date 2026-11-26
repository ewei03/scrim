// Runs on globle-game.com. Watches today's game; once it's won, sends the
// result to the background worker for submission.
(function () {
  ScrimContent.watch({
    game: "globle",
    find: () => ScrimGloble.findFinishedGames(Object.entries(localStorage), ScrimContent.localDate()),
    key: (g) => `${g.puzzle}:${g.guesses}`,
    toResult: ScrimGloble.toResult,
    shareText: ScrimGloble.shareText,
    label: () => "Today's Globle",
    score: ScrimGloble.formatScore,
    today: () => String(ScrimGloble.numberFromDate(ScrimContent.localDate())),
  });
})();
