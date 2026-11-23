// Runs on costcodle.com. Watches the saved Checkout games; when one finishes,
// sends the result to the background worker for submission.
(function () {
  const today = () => ScrimCostcodle.numberFromDate(ScrimContent.localDate());

  ScrimContent.watch({
    game: "costcodle",
    find: () => ScrimCostcodle.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.offs.join(",")}`,
    toResult: ScrimCostcodle.toResult,
    shareText: ScrimCostcodle.shareText,
    label: (r) => `Costcodle Checkout #${r.puzzle}`,
    score: ScrimCostcodle.formatScore,
    today: () => String(today()),
    // Let the receipt finish printing before the notice shows.
    delayMs: 1500,
  });
})();
