// Runs on wafflegame.net. Watches the saved daily; when it's over, sends the
// result to the background worker for submission.
(function () {
  const today = () => ScrimWaffle.numberAt(Date.now());

  ScrimContent.watch({
    game: "waffle",
    find: () => ScrimWaffle.findFinishedGames(Object.entries(localStorage), today()),
    key: (g) => `${g.puzzle}:${g.solved}:${g.stars}`,
    toResult: ScrimWaffle.toResult,
    shareText: ScrimWaffle.shareText,
    label: (r) => `Waffle #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimWaffle.formatScore,
    today: () => String(today()),
    // Let the last swap's animation finish before the notice shows.
    delayMs: 1500,
  });
})();
