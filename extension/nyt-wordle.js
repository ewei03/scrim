// Runs on nytimes.com/games/wordle. Watches NYT's saved game state; when a
// game finishes, sends the result to the background worker for submission.
(function () {
  const POLL_MS = 1000;
  const REVEAL_DELAY_MS = 2500; // let the tile flip animation finish
  const handled = new Set();

  function readTileRows() {
    return [...document.querySelectorAll('[role="group"][aria-label^="Row"]')].map((row) =>
      [...row.querySelectorAll('[data-testid="tile"]')].map((t) => t.dataset.state),
    );
  }

  async function tick() {
    let games;
    try {
      games = ScrimWordle.findFinishedGames(Object.entries(localStorage));
    } catch {
      return;
    }
    for (const game of games) {
      const key = `${game.puzzle}:${game.guesses.join(",")}`;
      if (handled.has(key)) continue;
      handled.add(key);
      await new Promise((r) => setTimeout(r, REVEAL_DELAY_MS));
      const result = ScrimWordle.toResult(game, readTileRows());
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "result",
          game: "wordle",
          result,
          raw: ScrimWordle.shareText(result),
        });
        showToast(reply, result);
      } catch (e) {
        showToast({ ok: false, error: String(e?.message ?? e) }, result);
      }
    }
  }

  function showToast(reply, result) {
    if (!reply) return;
    const label = `Wordle #${Number(result.puzzle).toLocaleString("en-US")}`;
    const score = `${result.solved ? result.guesses : "X"}/6`;
    let title;
    let body;
    if (!reply.ok && reply.error === "not-connected") {
      title = "Not connected";
      body = "Open Scrim, go to Profile, and click Connect extension.";
    } else if (!reply.ok) {
      title = "Couldn’t submit";
      body = reply.error;
    } else {
      const submitted = reply.lobbies.filter((l) => l.outcome === "submitted");
      if (!reply.isNew && submitted.length === 0) return; // already reported on an earlier visit
      if (submitted.length) {
        title = `${score} locked in ⚡`;
        body = `${label} → ${submitted.map((l) => l.crew_name).join(", ")}`;
      } else if (reply.lobbies.some((l) => l.outcome === "already")) {
        title = "Already submitted";
        body = `${label} is already in your lobbies.`;
      } else {
        title = `${score} saved`;
        body = `No open lobby for ${label} yet. Scrim will submit it when you open one.`;
      }
    }

    const host = document.createElement("div");
    host.dataset.scrimToast = "";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .t{font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#fbf9f4;color:#1c1b19;
           border:2px solid #1c1b19;box-shadow:3px 3px 0 #1c1b19;padding:10px 14px;max-width:320px;cursor:pointer}
        .h{font-weight:700;letter-spacing:.06em;font-size:12px;color:#ff5b1f}
        .ti{font-weight:700;margin:2px 0}
      </style>
      <div class="t" role="status"><div class="h">SCRIM</div><div class="ti"></div><div class="b"></div></div>`;
    shadow.querySelector(".ti").textContent = title;
    shadow.querySelector(".b").textContent = body;
    host.addEventListener("click", () => host.remove());
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 9000);
  }

  setInterval(tick, POLL_MS);
  tick();
})();
