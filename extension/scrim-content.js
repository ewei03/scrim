// Shared by the game content scripts: watch the page for finished games,
// hand each one to the background worker, and show a small notice.
(function (root) {
  const POLL_MS = 1000;

  /**
   * @param {object} opts
   * @param {string} opts.game        Scrim game id
   * @param {() => object[]} opts.find finished games read from the page
   * @param {(g: object) => string} opts.key  identifies a game so it's handled once per change
   * @param {(g: object) => object | Promise<object>} opts.toResult
   * @param {(r: object) => string} opts.shareText
   * @param {(r: object) => string} opts.label  e.g. "Wordle #1,979"
   * @param {(r: object) => string} opts.score  e.g. "3/6"
   * @param {number} [opts.delayMs]  wait before reading, e.g. for animations
   * @param {string} [opts.signInTo]  only count games with `signedIn: true`; games
   *   finished while signed out get a notice naming this site instead
   * @param {() => string} [opts.today]  today's puzzle id. Older puzzles are still
   *   sent (a crew whose day hasn't ended yet may count them), but quietly: the
   *   notices are only for today's game.
   */
  function watch(opts) {
    // The background worker may inject this into a tab that already has it.
    root.__scrimWatching ??= {};
    if (root.__scrimWatching[opts.game]) return;
    root.__scrimWatching[opts.game] = true;
    const handled = new Set();
    async function tick() {
      let games;
      try {
        games = opts.find();
      } catch {
        return;
      }
      if (opts.signInTo) {
        const counted = new Set(games.filter((g) => g.signedIn).map((g) => g.puzzle));
        for (const game of games) {
          if (game.signedIn || counted.has(game.puzzle) || !isToday(opts, game.puzzle)) continue;
          noticeSignedOut(opts, game);
        }
        games = games.filter((g) => g.signedIn);
      }
      for (const game of games) {
        const key = opts.key(game);
        if (handled.has(key)) continue;
        handled.add(key);
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        const result = await opts.toResult(game);
        try {
          const reply = await chrome.runtime.sendMessage({
            type: "result",
            game: opts.game,
            result,
            raw: opts.shareText(result),
          });
          if (isToday(opts, result.puzzle)) showToast(reply, opts.label(result), opts.score(result));
        } catch (e) {
          if (isToday(opts, result.puzzle)) {
            showToast({ ok: false, error: String(e?.message ?? e) }, opts.label(result), opts.score(result));
          }
        }
      }
    }
    setInterval(tick, POLL_MS);
    tick();
  }

  function isToday(opts, puzzle) {
    return !opts.today || String(puzzle) === opts.today();
  }

  /** "2026-11-20" where the player is. */
  function localDate(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /** "2026-11-20" in New York (games whose day runs on New York time). */
  function newYorkDate(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  }

  /** Once per puzzle per browser session, so it doesn't nag on every visit. */
  function noticeSignedOut(opts, game) {
    const seen = `scrim-signed-out-notice:${opts.game}:${game.puzzle}`;
    try {
      if (sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, "1");
    } catch {
      // Storage blocked: show it anyway.
    }
    show(
      "Not counted: signed out",
      `You played ${opts.label(game)} while signed out of ${opts.signInTo}. Sign in to ${opts.signInTo} and play there for Scrim to count it.`,
    );
  }

  function showToast(reply, label, score) {
    if (!reply) return;
    let title;
    let body;
    if (!reply.ok && reply.error === "not-connected") {
      title = "Not connected";
      body = "Open Scrim, go to Profile, and click Connect extension.";
    } else if (!reply.ok) {
      title = "Couldn’t submit";
      body = reply.error;
    } else {
      const submitted = reply.crews.filter((c) => c.outcome === "submitted");
      if (!reply.isNew && submitted.length === 0) return; // already reported on an earlier visit
      if (submitted.length) {
        title = `${score} locked in ⚡`;
        body = `${label} → ${submitted.map((c) => c.crew_name).join(", ")}`;
      } else if (reply.crews.some((c) => c.outcome === "already")) {
        title = "Already submitted";
        body = `${label} is already in your crews.`;
      } else if (reply.crews.length) {
        title = "Not counted";
        body = `${label}'s day is over in your crews.`;
      } else {
        title = `${score} saved`;
        body = `None of your crews play this yet. Scrim will submit it if one starts today.`;
      }
    }

    show(title, body);
  }

  function show(title, body) {
    // One notice at a time: a new one replaces any still showing (from this
    // game's script or another's, so this looks at the page, not a variable).
    for (const old of document.querySelectorAll("[data-scrim-toast]")) old.remove();
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

  root.ScrimContent = { watch, localDate, newYorkDate };
})(globalThis);
