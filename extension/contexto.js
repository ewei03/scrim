// Runs on contexto.me. Watches the saved daily games; when one finishes,
// sends the result to the background worker for submission.
(function () {
  // Who's signed in to Contexto, if anyone: Firebase Auth keeps the user in
  // IndexedDB ("firebaseLocalStorageDb"), or in localStorage as a fallback.
  // Nothing is read until the first look is done, so a signed-in game isn't
  // taken for a signed-out one.
  let account = null;
  let accountRead = false;

  function fromLocalStorage() {
    for (const [key, value] of Object.entries(localStorage)) {
      if (!key.startsWith("firebase:authUser:")) continue;
      try {
        return JSON.parse(value)?.uid ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function fromIndexedDb() {
    // Only open the database if it exists: opening a missing one would create
    // an empty one, which Firebase would then fail to set up.
    const dbs = (await indexedDB.databases?.().catch(() => [])) ?? [];
    if (!dbs.some((d) => d.name === "firebaseLocalStorageDb")) return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("firebaseLocalStorageDb");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains("firebaseLocalStorage")) return null;
      const rows = await new Promise((resolve, reject) => {
        const req = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });
      const user = rows.find((r) => String(r?.fbase_key ?? "").startsWith("firebase:authUser:"));
      return user?.value?.uid ?? null;
    } finally {
      db.close();
    }
  }

  async function readAccount() {
    try {
      account = (await fromIndexedDb()) ?? fromLocalStorage();
    } catch {
      account = fromLocalStorage();
    }
    accountRead = true;
  }
  readAccount();
  // Signing in or out while the page is open.
  setInterval(readAccount, 5000);

  const today = () => ScrimContexto.numberFromDate(ScrimContent.localDate());

  ScrimContent.watch({
    game: "contexto",
    find: () => (accountRead ? ScrimContexto.findFinishedGames(Object.entries(localStorage), today(), account) : []),
    key: (g) => `${g.puzzle}:${g.solved}:${g.guesses}`,
    toResult: ScrimContexto.toResult,
    shareText: ScrimContexto.shareText,
    label: (r) => `Contexto #${Number(r.puzzle).toLocaleString("en-US")}`,
    score: ScrimContexto.formatScore,
    today: () => String(today()),
  });
})();
