(async () => {
  const c = await chrome.storage.local.get(["token", "displayName", "results", "scrimOrigin", "popupView"]);
  const status = document.getElementById("status");
  if (c.token) {
    status.textContent = `⚡ Connected as ${c.displayName ?? "you"}`;
    status.classList.remove("muted");
  } else {
    status.textContent = "Not connected. Open Scrim and sign in to connect.";
  }

  // Results and rankings belong to a connected account; signed out, there's nothing to show.
  document.getElementById("panel-results").hidden = !c.token;
  if (c.token) {
    renderResults(c.results);
    setUpTabs(c.popupView ?? {}, c.scrimOrigin);
    // Re-send saved results: the server's reply lists only crews you're still
    // in, so crews you've left or that were deleted drop off each result.
    chrome.runtime
      .sendMessage({ type: "sync" })
      .then(async (reply) => {
        if (reply?.ok) renderResults((await chrome.storage.local.get("results")).results);
      })
      .catch(() => {});
  }
})();

/** Today's puzzle number per game, as the games number them (see background.js). */
function todaysPuzzles() {
  const now = new Date();
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now).split("-").map(Number);
  const newYork = Date.UTC(y, m - 1, d);
  const days = (from, start) => String(Math.round((from - start) / 86400000));
  return {
    wordle: days(local, Date.UTC(2021, 5, 19)),
    connections: days(local, Date.UTC(2023, 5, 11)),
    krillion: days(newYork, Date.UTC(2026, 6, 15)),
  };
}

/**
 * Today's results for games one of your crews plays. Earlier days', and games
 * no crew of yours plays yet, are kept (for syncing: joining a crew that plays
 * it submits it then) but not listed.
 */
function renderResults(stored) {
  // e.g. "Results for Friday, November 20."
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("results-date").textContent = `Results for ${date}.`;
  const today = todaysPuzzles();
  const results = Object.values(stored ?? {})
    .filter((r) => String(r.result?.puzzle) === today[r.game] && (r.crews ?? []).length > 0)
    .sort((a, b) => b.seenAt - a.seenAt);
  const list = document.getElementById("results");
  list.replaceChildren();
  for (const r of results.slice(0, 7)) {
    const { name, score } = describe(r.game, r.result);
    const sent = (r.crews ?? []).filter((c) => c.outcome === "submitted" || c.outcome === "already").length;
    const left = document.createElement("span");
    left.textContent = `${name} #${Number(r.result.puzzle).toLocaleString("en-US")} · ${score}`;
    const right = document.createElement("span");
    right.className = "muted";
    right.textContent = sent ? `${sent} ${sent === 1 ? "crew" : "crews"}` : "waiting";
    const li = document.createElement("li");
    li.append(left, right);
    list.append(li);
  }
  list.hidden = results.length === 0;
  document.getElementById("results-empty").hidden = results.length > 0;
}

const GAME_NAMES = { wordle: "Wordle", connections: "Connections", krillion: "Krillion" };

/** Results / Rankings tabs. Remembers the last tab, crew and game. */
function setUpTabs(view, scrimOrigin) {
  const tabs = { results: document.getElementById("tab-results"), rankings: document.getElementById("tab-rankings") };
  const panels = { results: document.getElementById("panel-results"), rankings: document.getElementById("panel-rankings") };
  let loaded = false;

  function select(name) {
    for (const key of Object.keys(tabs)) {
      tabs[key].setAttribute("aria-selected", String(key === name));
      panels[key].hidden = key !== name;
    }
    view.tab = name;
    save(view);
    if (name === "rankings" && !loaded) {
      loaded = true;
      loadRankings(view, scrimOrigin);
    }
  }

  document.getElementById("tabs").hidden = false;
  tabs.results.addEventListener("click", () => select("results"));
  tabs.rankings.addEventListener("click", () => select("rankings"));
  select(view.tab === "rankings" ? "rankings" : "results");
}

async function loadRankings(view, scrimOrigin) {
  const status = document.getElementById("rankings-status");
  const reply = await chrome.runtime.sendMessage({ type: "rankings" }).catch(() => null);
  if (!reply?.ok) {
    status.textContent =
      reply?.error === "not-connected"
        ? "Not connected. Open Scrim and sign in to connect."
        : `Couldn't load rankings${reply?.error ? `: ${reply.error}` : "."}`;
    return;
  }
  if (reply.rows.length === 0) {
    status.textContent = "No rankings yet.";
    return;
  }

  // Crews (in server order) -> games -> players, already ranked.
  const crews = new Map();
  for (const row of reply.rows) {
    if (!crews.has(row.crew_code)) crews.set(row.crew_code, { name: row.crew_name, games: new Map() });
    const games = crews.get(row.crew_code).games;
    if (!games.has(row.game)) games.set(row.game, []);
    games.get(row.game).push(row);
  }

  const pickCrew = document.getElementById("pick-crew");
  const pickGame = document.getElementById("pick-game");
  for (const [code, crew] of crews) pickCrew.append(new Option(crew.name, code));
  pickCrew.value = crews.has(view.crew) ? view.crew : crews.keys().next().value;

  function fillGames() {
    const games = crews.get(pickCrew.value).games;
    // The server names each game (custom games have their own names).
    pickGame.replaceChildren(
      ...[...games.entries()].map(([g, players]) => new Option(players[0]?.game_name ?? GAME_NAMES[g] ?? g, g)),
    );
    pickGame.value = games.has(view.game) ? view.game : games.keys().next().value;
  }

  function render() {
    view.crew = pickCrew.value;
    view.game = pickGame.value;
    save(view);
    const players = crews.get(view.crew).games.get(view.game);
    document.getElementById("rankings-body").replaceChildren(
      ...players.map((p) => {
        const tr = document.createElement("tr");
        if (p.is_me) tr.className = "me";
        const cells = [sharedRank(players, p), p.display_name, p.wins, p.played, p.streak ? `${p.streak}W` : "–"];
        for (const [i, value] of cells.entries()) {
          const td = document.createElement("td");
          if (i === 1) td.className = "name";
          td.textContent = String(value);
          tr.append(td);
        }
        return tr;
      }),
    );
    const link = document.getElementById("open-crew");
    link.hidden = !scrimOrigin;
    if (scrimOrigin) link.href = `${scrimOrigin}/crew/${view.crew}`;
  }

  pickCrew.addEventListener("change", () => {
    fillGames();
    render();
  });
  pickGame.addEventListener("change", render);
  fillGames();
  render();
  status.hidden = true;
  document.getElementById("rankings").hidden = false;
}

/** Players with identical records share a rank, like on the site. */
function sharedRank(players, p) {
  return 1 + players.findIndex((o) => o.wins === p.wins && o.played === p.played);
}

function save(view) {
  chrome.storage.local.set({ popupView: view }).catch(() => {});
}

function describe(game, result) {
  if (game === "connections") {
    // Same as the site: "⭐" for no mistakes, "1❌" to "3❌" for mistakes, "💀" on the fourth.
    const score = !result.solved ? "💀" : result.mistakes === 0 ? "⭐" : `${result.mistakes}❌`;
    return { name: "Connections", score };
  }
  if (game === "krillion") return { name: "Krillion", score: result.points.toLocaleString("en-US") };
  return { name: "Wordle", score: `${result.solved ? result.guesses : "X"}/6` };
}
