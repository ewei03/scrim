// Runs on krillion.io. Watches the saved Daily Dive history; when a dive
// finishes, sends the result to the background worker for submission.
(function () {
  ScrimContent.watch({
    game: "krillion",
    find: () => ScrimKrillion.findFinishedDives(Object.entries(localStorage)),
    key: (d) => `${d.puzzle}:${d.tiers}`,
    toResult: ScrimKrillion.toResult,
    shareText: ScrimKrillion.shareText,
    label: (r) => `Krillion #${r.puzzle}`,
    score: ScrimKrillion.formatScore,
    today: () => String(ScrimKrillion.numberFromDate(ScrimContent.newYorkDate())),
  });
})();
