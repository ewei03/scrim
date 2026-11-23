// Runs on poople.io. Watches today's path; once it reaches POOP, sends the
// result to the background worker for submission.
(function () {
  // The shortest path is only on the page, in the results under the board:
  // "You used N guesses. The best solution was M guesses."
  const best = () => ScrimPoople.bestFrom(document.querySelector(".Results")?.textContent);

  ScrimContent.watch({
    game: "poople",
    find: () => ScrimPoople.findFinishedGames(Object.entries(localStorage), best(), Date.now()),
    key: (g) => `${g.puzzle}:${g.guesses}`,
    toResult: ScrimPoople.toResult,
    shareText: ScrimPoople.shareText,
    label: (r) => `Poople #${r.puzzle}`,
    score: ScrimPoople.formatScore,
    today: () => String(ScrimPoople.numberAt(Date.now())),
  });
})();
