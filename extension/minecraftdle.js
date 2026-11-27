// Runs on minecraftdle.com. Watches each mode's daily; once one is won, sends
// the result to the background worker for submission.
(function () {
  const today = () => ScrimMinecraftdle.numberFromDate(ScrimMinecraftdle.madridDate(Date.now()));

  for (const mode of ScrimMinecraftdle.MODES) {
    ScrimContent.watch({
      game: mode.game,
      find: () =>
        ScrimMinecraftdle.findFinishedGames(Object.entries(localStorage), today()).filter((g) => g.game === mode.game),
      key: (g) => `${g.puzzle}:${g.guesses}`,
      toResult: ScrimMinecraftdle.toResult,
      shareText: (r) => ScrimMinecraftdle.shareText(mode.game, r),
      label: (r) => `Minecraftdle ${mode.noun} #${Number(r.puzzle).toLocaleString("en-US")}`,
      score: ScrimMinecraftdle.formatScore,
      today: () => String(today()),
      // Let the last guess's reveal finish first.
      delayMs: 1500,
    });
  }
})();
