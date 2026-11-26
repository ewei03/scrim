// Runs on costcodle.com. Watches the saved Checkout and Classic games (each
// its own game in Scrim); when one finishes, sends the result to the
// background worker for submission.
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

  const classicToday = () => ScrimCostcodleClassic.numberFromDate(ScrimContent.localDate());
  ScrimContent.watch({
    game: "costcodleclassic",
    find: () => ScrimCostcodleClassic.findFinishedGames(Object.entries(localStorage), classicToday()),
    key: (g) => `${g.puzzle}:${g.grid.join(",")}`,
    toResult: ScrimCostcodleClassic.toResult,
    shareText: ScrimCostcodleClassic.shareText,
    label: (r) => `Costcodle Classic #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimCostcodleClassic.formatScore,
    today: () => String(classicToday()),
    // Let the win or loss message show before the notice does.
    delayMs: 1500,
  });
})();
