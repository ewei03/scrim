// Runs on minicrossword.com. Watches the saved Easy and Hard dailies (each its
// own game in Scrim); when one is solved, sends the result to the background
// worker for submission.
(function () {
  const today = () => ScrimMini.numberFromDate(ScrimContent.localDate());

  for (const [game, level, name] of [
    ["minicrossword", "easy", "Easy"],
    ["minicrosswordhard", "hard", "Hard"],
  ]) {
    ScrimContent.watch({
      game,
      find: () => ScrimMini.findFinishedGames(Object.entries(localStorage), today(), level),
      key: (g) => `${g.puzzle}:${g.seconds}:${g.reveals}`,
      toResult: ScrimMini.toResult,
      shareText: (r) => ScrimMini.shareText(r, level),
      label: (r) => `Mini Crossword ${name} #${r.puzzle}`,
      score: ScrimMini.formatScore,
      today: () => String(today()),
    });
  }
})();
