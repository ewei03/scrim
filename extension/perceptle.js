// Runs on perceptle.com. Watches today's saved game; once all five tests are
// done, sends the result to the background worker for submission.
(function () {
  ScrimContent.watch({
    game: "perceptle",
    find: () => ScrimPerceptle.findFinishedGames(Object.entries(localStorage), ScrimContent.localDate()),
    key: (g) => `${g.puzzle}:${g.events.join(",")}`,
    toResult: ScrimPerceptle.toResult,
    shareText: ScrimPerceptle.shareText,
    label: (r) => `Perceptle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimPerceptle.formatScore,
    today: () => String(ScrimPerceptle.numberFromDate(ScrimContent.localDate())),
  });
})();
