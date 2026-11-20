// Holds the connection to Scrim and submits results.
const CONFIG_KEYS = ["token", "supabaseUrl", "supabaseKey", "scrimOrigin", "userId", "displayName"];
const MAX_RESULTS = 14;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
      await chrome.storage.local.set({ token, supabaseUrl, supabaseKey, scrimOrigin, userId, displayName });
      // Anything played before connecting gets submitted now: results already
      // seen, then today's games that finished while nothing was watching.
      const synced = await syncAll();
      catchUp().catch(() => {});
      return { ok: true, ...synced };
    }
    case "unpair":
      await chrome.storage.local.remove(CONFIG_KEYS);
      return { ok: true };
    case "status": {
      const c = await chrome.storage.local.get(["token", "userId", "displayName"]);
      return { ok: true, connected: Boolean(c.token), userId: c.userId ?? null, displayName: c.displayName ?? null };
    }
    case "result":
      return submitResult(msg.game, msg.result, msg.raw);
    case "sync":
      return { ok: true, ...(await syncAll()) };
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
  results[key] = { game, result, raw, seenAt: previous?.seenAt ?? Date.now(), lobbies: previous?.lobbies ?? [] };
  const reply = await callSubmit(game, result, raw);
  if (reply.ok) results[key].lobbies = mergeLobbies(results[key].lobbies, reply.lobbies);
  await chrome.storage.local.set({ results: prune(results) });
  return { ...reply, isNew };
}

/** Re-submit recent results, e.g. when a lobby was created after you played. The server is idempotent. */
async function syncAll() {
  const results = await getResults();
  let submitted = 0;
  for (const entry of Object.values(results)) {
    const reply = await callSubmit(entry.game, entry.result, entry.raw);
    if (!reply.ok) return { submitted, error: reply.error };
    entry.lobbies = mergeLobbies(entry.lobbies, reply.lobbies);
    submitted += reply.lobbies.filter((l) => l.outcome === "submitted").length;
  }
  await chrome.storage.local.set({ results });
  return { submitted };
}

async function callSubmit(game, result, raw) {
  const c = await chrome.storage.local.get(["token", "supabaseUrl", "supabaseKey"]);
  if (!c.token) return { ok: false, error: "not-connected" };
  let res;
  try {
    res = await fetch(`${c.supabaseUrl}/rest/v1/rpc/extension_submit`, {
      method: "POST",
      headers: {
        apikey: c.supabaseKey,
        Authorization: `Bearer ${c.supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: c.token, p_game: game, p_result: result, p_raw: raw ?? null }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach Scrim. Check your connection." };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.message ?? `HTTP ${res.status}`;
    if (/not connected/i.test(error)) {
      await chrome.storage.local.remove(CONFIG_KEYS); // token was revoked
      return { ok: false, error: "not-connected" };
    }
    return { ok: false, error };
  }
  return { ok: true, lobbies: body ?? [] };
}

/**
 * The server's reply lists every lobby you're currently in for that puzzle, so
 * it replaces the stored list: lobbies from deleted or left crews drop out.
 */
function mergeLobbies(previous, next) {
  const before = new Map(previous.map((l) => [l.lobby_code, l]));
  // Keep "submitted" once it happened, even if later calls report "already".
  return next.map((l) => (before.get(l.lobby_code)?.outcome === "submitted" ? before.get(l.lobby_code) : l));
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
