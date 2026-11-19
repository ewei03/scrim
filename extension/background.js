// Holds the connection to Scrim and submits results.
const CONFIG_KEYS = ["token", "supabaseUrl", "supabaseKey", "scrimOrigin", "userId", "displayName"];
const MAX_RESULTS = 14;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true; // respond asynchronously
});

async function handle(msg) {
  switch (msg.type) {
    case "pair": {
      const { token, supabaseUrl, supabaseKey, scrimOrigin, userId, displayName } = msg;
      if (!token || !supabaseUrl || !supabaseKey) return { ok: false, error: "Missing pairing details" };
      await chrome.storage.local.set({ token, supabaseUrl, supabaseKey, scrimOrigin, userId, displayName });
      // Anything played before connecting gets submitted now.
      return { ok: true, ...(await syncAll()) };
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

function mergeLobbies(previous, next) {
  const byCode = new Map(previous.map((l) => [l.lobby_code, l]));
  for (const l of next) {
    // Keep "submitted" once it happened, even if later calls report "already".
    if (byCode.get(l.lobby_code)?.outcome !== "submitted") byCode.set(l.lobby_code, l);
  }
  return [...byCode.values()];
}

function prune(results) {
  const entries = Object.entries(results).sort((a, b) => b[1].seenAt - a[1].seenAt);
  return Object.fromEntries(entries.slice(0, MAX_RESULTS));
}
