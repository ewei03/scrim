// Shared by the game content scripts: watch the page for finished games,
// hand each one to the background worker, and show a small notice.
(function (root) {
  const POLL_MS = 1000;
  const AT_LOAD_MS = 5000;
  /** A send that failed (e.g. the background worker was waking up) is retried this many times. */
  const MAX_TRIES = 5;

  /** Shows in the game page's console, filtered by "[Scrim]". */
  function log(...args) {
    console.debug("[Scrim]", ...args);
  }

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
    /** key -> failed sends so far, and when the next try may happen. */
    const retries = new Map();
    let lastSeen = "";
    // Games already finished when the page opened, as opposed to ones seen
    // finishing while it's open. After the extension switches Scrim accounts,
    // these are taken to be the previous person's. "When it opened" allows a
    // few seconds: signed in, NYT loads the saved game from its server.
    const startedAt = Date.now();
    let timer;
    async function tick() {
      // The extension was reloaded or updated since this page loaded: this copy
      // of the script can't reach it any more ("Extension context invalidated").
      // Stop quietly; reloading the page brings in the new one.
      if (!alive()) return clearInterval(timer);
      let games;
      try {
        games = opts.find();
      } catch (e) {
        log(opts.game, "couldn't read the page:", e);
        return;
      }
      const seen = games.map(opts.key).join(" | ");
      if (seen !== lastSeen) {
        lastSeen = seen;
        log(opts.game, "finished games on the page:", seen || "none");
      }
      const atLoad = Date.now() - startedAt < AT_LOAD_MS;
      // Signed-out games count too. If a puzzle was played both ways, the
      // signed-in save wins.
      const signedIn = new Set(games.filter((g) => g.signedIn).map((g) => g.puzzle));
      games = games.filter((g) => g.signedIn !== false || !signedIn.has(g.puzzle));
      for (const game of games) {
        const key = opts.key(game);
        if (handled.has(key)) continue;
        const retry = retries.get(key);
        if (retry && Date.now() < retry.at) continue;
        handled.add(key);
        // Once a send fails it's retried, with a growing wait, before giving up.
        const failed = (why, result) => {
          const tries = (retry?.tries ?? 0) + 1;
          log(opts.game, `send ${tries}/${MAX_TRIES} failed for ${key}:`, why);
          if (tries >= MAX_TRIES) {
            retries.delete(key);
            if (result && isToday(opts, result.puzzle)) {
              showToast({ ok: false, error: String(why) }, opts.label(result), opts.score(result));
            }
            return;
          }
          retries.set(key, { tries, at: Date.now() + 1000 * 2 ** tries });
          handled.delete(key);
        };
        if (opts.delayMs && !retry) await new Promise((r) => setTimeout(r, opts.delayMs));
        let result;
        try {
          result = await opts.toResult(game);
        } catch (e) {
          failed(e?.message ?? e, null);
          continue;
        }
        log(opts.game, "sending", key, result);
        try {
          const reply = await chrome.runtime.sendMessage({
            type: "result",
            game: opts.game,
            result,
            raw: opts.shareText(result),
            // Who played it: the game account, if signed in to the game. The
            // background worker hashes it before sending it anywhere.
            account: game.account ?? null,
            atLoad,
          });
          log(opts.game, "reply for", key, reply);
          // No reply, or the server couldn't be reached: try again shortly.
          // (Not connected won't fix itself, so that's shown straight away.)
          if (!reply || (!reply.ok && reply.error !== "not-connected")) {
            failed(reply?.error ?? "no reply from the extension", result);
            continue;
          }
          retries.delete(key);
          if (isToday(opts, result.puzzle)) showToast(reply, opts.label(result), opts.score(result));
        } catch (e) {
          if (!alive()) return clearInterval(timer);
          failed(e?.message ?? e, result);
        }
      }
    }
    timer = setInterval(tick, POLL_MS);
    tick();
  }

  /** False once the extension has been reloaded or updated under this page. */
  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
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

  function showToast(reply, label, score) {
    if (!reply) return;
    let title;
    let body;
    if (reply.ok && reply.notYours) {
      title = "Not counted";
      body = `${label} was played on another Scrim account.`;
    } else if (reply.ok && reply.beforeSwitch) {
      if (!once(`before-switch:${label}`)) return;
      title = "Not counted";
      body = `${label} was finished before you signed in to Scrim on this browser.`;
    } else if (!reply.ok && reply.error === "not-connected") {
      title = "Not connected";
      body = "Open Scrim and sign in to connect.";
    } else if (!reply.ok) {
      title = "Couldn’t submit";
      body = reply.error;
    } else {
      const submitted = reply.crews.filter((c) => c.outcome === "submitted");
      // Already reported on an earlier visit (a void is reported once, too).
      if (!reply.isNew && submitted.length === 0 && !reply.newlyVoided) return;
      if (submitted.length) {
        title = `${score} locked in ⚡`;
        body = `${label} → ${submitted.map((c) => c.crew_name).join(", ")}`;
      } else if (reply.crews.some((c) => c.outcome === "voided")) {
        title = "Voided";
        body = `The crew owner voided ${label}. Play it again to submit a new result.`;
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

  /** True the first time it's asked about `what` in this browser session. */
  function once(what) {
    const seen = `scrim-notice:${what}`;
    try {
      if (sessionStorage.getItem(seen)) return false;
      sessionStorage.setItem(seen, "1");
    } catch {
      // Storage blocked: show it anyway.
    }
    return true;
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
