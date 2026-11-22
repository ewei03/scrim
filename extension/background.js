// Holds the connection to Scrim and submits results.
const CONFIG_KEYS = ["token", "supabaseUrl", "supabaseKey", "scrimOrigin", "userId", "displayName"];
/** Everything tied to the connected account: its connection and the results seen for it. */
const ACCOUNT_KEYS = [...CONFIG_KEYS, "results"];
const MAX_RESULTS = 14;

// What this build may talk to, read from the manifest (the store build drops
// localhost). Chrome's "http://localhost/*" matches any port, so hosts are
// compared by protocol and hostname.
const MANIFEST = chrome.runtime.getManifest();
const hostOf = (pattern) => {
  const u = new URL(pattern.replace(/\*$/, ""));
  return `${u.protocol}//${u.hostname}`;
};
/** Pages of the Scrim site: the ones the bridge script runs on. */
const SITE_HOSTS = new Set(
  MANIFEST.content_scripts.filter((cs) => cs.js.includes("scrim-bridge.js")).flatMap((cs) => cs.matches.map(hostOf)),
);
/** Supabase projects results may be sent to: a host permission that's Supabase (or local, for development). */
const API_HOSTS = new Set(
  MANIFEST.host_permissions.map(hostOf).filter((h) => /^https:\/\/[a-z0-9-]+\.supabase\.co$|^http:\/\/(localhost|127\.0\.0\.1)$/.test(h)),
);
const isAllowed = (url, hosts) => {
  try {
    return hosts.has(hostOf(url));
  } catch {
    return false;
  }
};

// Connecting and disconnecting only come from the Scrim site (via the bridge).
// Anything else could point the extension at another server or account.
const SITE_ONLY = new Set(["pair", "unpair"]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fromSite = sender.id === chrome.runtime.id && isAllowed(sender.url ?? "", SITE_HOSTS);
  if (SITE_ONLY.has(msg?.type) && !fromSite) {
    sendResponse({ ok: false, error: "Connect the extension from the Scrim website." });
    return false;
  }
  // The site's origin comes from the page the message came from, not the message.
  if (fromSite) msg = { ...msg, scrimOrigin: new URL(sender.url).origin };
  handle(msg).then(
    (reply) => {
      sendResponse(reply);
      if (msg.type === "result") visits.get(sender.tab?.id)?.();
    },
    (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
  );
  return true; // respond asynchronously
});

// Chrome doesn't add content scripts to tabs that were already open when the
// extension was installed or updated, so add them now.
chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenTabs().catch(() => {});
});

async function handle(msg) {
  switch (msg.type) {
    case "pair": {
      const { token, supabaseUrl, supabaseKey, scrimOrigin, userId, displayName } = msg;
      if (!token || !supabaseUrl || !supabaseKey) return { ok: false, error: "Missing pairing details" };
      if (!isAllowed(supabaseUrl, API_HOSTS)) return { ok: false, error: "That server isn't one Scrim uses" };
      // Results seen for someone else stay theirs: a different account (or a
      // connection too old to say whose it was) starts with none.
      const before = await chrome.storage.local.get("userId");
      if (!before.userId || before.userId !== userId) await chrome.storage.local.remove("results");
      await chrome.storage.local.set({ token, supabaseUrl, supabaseKey, scrimOrigin, userId, displayName });
      // Anything played before connecting gets submitted now: results already
      // seen, then today's games that finished while nothing was watching.
      const synced = await syncAll();
      catchUp().catch(() => {});
      return { ok: true, ...synced };
    }
    case "unpair":
      await chrome.storage.local.remove(ACCOUNT_KEYS);
      return { ok: true };
    case "status": {
      const c = await chrome.storage.local.get(["token", "userId", "displayName"]);
      return { ok: true, connected: Boolean(c.token), userId: c.userId ?? null, displayName: c.displayName ?? null };
    }
    case "result":
      return submitResult(msg.game, msg.result, msg.raw);
    case "sync":
      return { ok: true, ...(await syncAll()) };
    case "rankings": {
      const reply = await callRpc("extension_rankings", {});
      return reply.ok ? { ok: true, rows: reply.body ?? [] } : reply;
    }
    default:
      return { ok: false, error: `Unknown message: ${msg.type}` };
  }
}

async function getResults() {
  return (await chrome.storage.local.get("results")).results ?? {};
}

async function submitResult(game, result, raw) {
  const results = await getResults();
  const key = `${game}:${result.puzzle}`;
  const previous = results[key];
  const isNew = !previous;
  results[key] = { game, result, raw, seenAt: previous?.seenAt ?? Date.now(), crews: previous?.crews ?? [] };
  const reply = await callSubmit(game, result, raw);
  let newlyVoided = false;
  if (reply.ok) {
    const wasVoided = results[key].crews.some((c) => c.outcome === "voided");
    results[key].crews = mergeCrews(results[key].crews, reply.crews);
    newlyVoided = !wasVoided && reply.crews.some((c) => c.outcome === "voided");
  }
  await chrome.storage.local.set({ results: prune(results) });
  return { ...reply, isNew, newlyVoided };
}

/** Re-submit recent results, e.g. after joining a crew or a crew picking a game. The server is idempotent. */
async function syncAll() {
  const results = await getResults();
  let submitted = 0;
  for (const entry of Object.values(results)) {
    const reply = await callSubmit(entry.game, entry.result, entry.raw);
    if (!reply.ok) return { submitted, error: reply.error };
    entry.crews = mergeCrews(entry.crews ?? [], reply.crews);
    submitted += reply.crews.filter((c) => c.outcome === "submitted").length;
  }
  await chrome.storage.local.set({ results });
  return { submitted };
}

async function callSubmit(game, result, raw) {
  const reply = await callRpc("extension_submit", { p_game: game, p_result: result, p_raw: raw ?? null });
  return reply.ok ? { ok: true, crews: reply.body ?? [] } : reply;
}

/** Calls a token-authorised RPC. Signs the extension out if the token was revoked. */
async function callRpc(fn, args) {
  const c = await chrome.storage.local.get(["token", "supabaseUrl", "supabaseKey"]);
  if (!c.token) return { ok: false, error: "not-connected" };
  let res;
  try {
    res = await fetch(`${c.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: c.supabaseKey,
        Authorization: `Bearer ${c.supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: c.token, ...args }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach Scrim. Check your connection." };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.message ?? `HTTP ${res.status}`;
    if (/not connected/i.test(error)) {
      await chrome.storage.local.remove(ACCOUNT_KEYS); // token was revoked
      return { ok: false, error: "not-connected" };
    }
    return { ok: false, error };
  }
  return { ok: true, body };
}

/**
 * The server's reply lists every crew you're in that plays this game, so it
 * replaces the stored list: deleted or left crews drop out.
 */
function mergeCrews(previous, next) {
  const before = new Map(previous.map((c) => [c.crew_code, c]));
  // Keep "submitted" once it happened while later calls report "already",
  // but not once the crew owner voids it.
  return next.map((c) =>
    c.outcome === "already" && before.get(c.crew_code)?.outcome === "submitted" ? before.get(c.crew_code) : c,
  );
}

function prune(results) {
  const entries = Object.entries(results).sort((a, b) => b[1].seenAt - a[1].seenAt);
  return Object.fromEntries(entries.slice(0, MAX_RESULTS));
}

// ---------------------------------------------------------------------------
// Catching up on games finished before the extension was connected
// ---------------------------------------------------------------------------

// A game's saved progress can only be read from its own page, so for each game
// with no result yet for today's puzzle, read it from an open tab or, failing
// that, open the page briefly in a background tab.
const CATCH_UP = [
  { game: "wordle", url: "https://www.nytimes.com/games/wordle/index.html", today: () => localDays(2021, 6, 19) },
  { game: "connections", url: "https://www.nytimes.com/games/connections", today: () => localDays(2023, 6, 11) },
  { game: "krillion", url: "https://krillion.io/", today: () => newYorkDays(2026, 7, 15) },
];
const VISIT_TIMEOUT_MS = 20000;
/** Tab id -> resolves the visit early once that tab reports a result. */
const visits = new Map();
let catchingUp = false;

async function catchUp() {
  if (catchingUp) return;
  catchingUp = true;
  try {
    for (const g of CATCH_UP) {
      const results = await getResults();
      if (results[`${g.game}:${g.today()}`]) continue;
      const scripts = contentScriptsFor(g.url);
      if (!scripts) continue;
      const open = await chrome.tabs.query({ url: scripts.matches });
      if (open.length) {
        // Its content script reports a finished game by itself; make sure it's there.
        await inject(open[0].id, scripts.js);
      } else {
        await visitInBackground(g.url);
      }
    }
  } finally {
    catchingUp = false;
  }
}

async function visitInBackground(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, VISIT_TIMEOUT_MS);
    visits.set(tab.id, () => {
      clearTimeout(timer);
      // Give the notice a moment, then close.
      setTimeout(resolve, 500);
    });
  });
  visits.delete(tab.id);
  await chrome.tabs.remove(tab.id).catch(() => {});
}

async function injectIntoOpenTabs() {
  for (const cs of chrome.runtime.getManifest().content_scripts ?? []) {
    for (const tab of await chrome.tabs.query({ url: cs.matches })) await inject(tab.id, cs.js);
  }
}

function inject(tabId, files) {
  return chrome.scripting.executeScript({ target: { tabId }, files }).catch(() => {});
}

function contentScriptsFor(url) {
  return (chrome.runtime.getManifest().content_scripts ?? []).find((cs) => cs.matches.some((m) => matchesPattern(m, url)));
}

/** Chrome match patterns here only use "*" as a wildcard. */
function matchesPattern(pattern, url) {
  const parts = pattern.split("*");
  if (!url.startsWith(parts[0])) return false;
  let at = parts[0].length;
  for (const part of parts.slice(1)) {
    const i = url.indexOf(part, at);
    if (i === -1) return false;
    at = i + part.length;
  }
  const last = parts[parts.length - 1];
  return parts.length > 1 ? last === "" || url.endsWith(last) : at === url.length;
}

/** Today's puzzle number for games numbered by the player's local date. */
function localDays(y, m, d) {
  const now = new Date();
  return String(Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000));
}

/** Today's puzzle number for games numbered by the New York date. */
function newYorkDays(y, m, d) {
  const [ny, nm, nd] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()).split("-").map(Number);
  return String(Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(y, m - 1, d)) / 86400000));
}
