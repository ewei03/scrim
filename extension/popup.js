(async () => {
  const c = await chrome.storage.local.get(["token", "displayName", "results", "scrimOrigin", "popupView"]);
  const status = document.getElementById("status");
  if (c.scrimOrigin) document.getElementById("scrim-link").href = c.scrimOrigin;
  if (c.token) {
    status.textContent = `⚡ Connected as ${c.displayName ?? "you"}`;
    status.classList.remove("muted");
  } else {
    const link = document.createElement("a");
    link.href = c.scrimOrigin ?? SCRIM_URL;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open Scrim";
    status.replaceChildren("Not connected. ", link, " and sign in to connect.");
  }

  // Results and rankings belong to a connected account; signed out, there's nothing to show.
  document.getElementById("panel-results").hidden = !c.token;
  if (c.token) {
    // What this browser saw, straight away; then the server's list, which also
    // has games played in other browsers.
    renderResults(c.results);
    setUpCheckGames();
    setUpTabs(c.popupView ?? {}, c.scrimOrigin);
    loadServerResults();
    // Re-send saved results (anything not submitted yet goes in now), then
    // ask the server again.
    chrome.runtime
      .sendMessage({ type: "sync" })
      .then(() => loadServerResults())
      .catch(() => {});
  }
})();

/** Where Scrim lives, until the site has told the extension (on connecting). */
const SCRIM_URL = "https://daily-scrim.vercel.app";

/** Today's results from the server, once loaded: null until then, or if it couldn't be reached. */
let serverResults = null;

async function loadServerResults() {
  const reply = await chrome.runtime.sendMessage({ type: "results", puzzles: todaysPuzzles() }).catch(() => null);
  // Unreachable (offline, or an older server): keep showing what this browser saw.
  if (reply?.ok) serverResults = reply.rows.filter((r) => Object.hasOwn(GAME_NAMES, r.game));
  renderResults((await chrome.storage.local.get("results")).results);
}

/** Today's puzzle number per game, as the games number them (see background.js). */
function todaysPuzzles() {
  const now = new Date();
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now).split("-").map(Number);
  const newYork = Date.UTC(y, m - 1, d);
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [my, mm, md] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now).split("-").map(Number);
  const madrid = Date.UTC(my, mm - 1, md);
  const sixAm = new Date(now.getTime() - 6 * 3600000);
  const angledleDay = Date.UTC(sixAm.getFullYear(), sixAm.getMonth(), sixAm.getDate());
  const days = (from, start) => String(Math.round((from - start) / 86400000));
  return {
    wordle: days(local, Date.UTC(2021, 5, 19)),
    connections: days(local, Date.UTC(2023, 5, 11)),
    strands: days(local, Date.UTC(2024, 2, 3)),
    krillion: days(newYork, Date.UTC(2026, 6, 15)),
    contexto: days(local, Date.UTC(2022, 8, 18)),
    costcodle: days(local, Date.UTC(2026, 10, 9)),
    costcodleclassic: days(local, Date.UTC(2023, 8, 19)),
    // One puzzle worldwide, changing at 08:00 UTC.
    poople: String(Math.floor((now.getTime() - 8 * 3600000 - Date.UTC(2025, 7, 14)) / 86400000)),
    minicrossword: days(local, Date.UTC(2026, 5, 21)),
    minicrosswordhard: days(local, Date.UTC(2026, 5, 21)),
    worldle: days(local, Date.UTC(2022, 0, 21)),
    globle: days(local, Date.UTC(2022, 0, 1)),
    perceptle: days(local, Date.UTC(2026, 6, 17)),
    // One puzzle worldwide per mode, changing at midnight in Madrid.
    minecraftdle: days(madrid, Date.UTC(2026, 10, 9)),
    minecraftdleitem: days(madrid, Date.UTC(2026, 10, 9)),
    minecraftdlemob: days(madrid, Date.UTC(2026, 10, 9)),
    // By local date, but Angledle's day starts at 6 am.
    angledle: days(angledleDay, Date.UTC(2022, 0, 1)),
    // One puzzle worldwide each, changing at midnight UTC.
    waffle: days(utc, Date.UTC(2022, 0, 21)),
    nerdle: days(utc, Date.UTC(2022, 0, 19)),
  };
}

/**
 * Today's results for games one of your crews plays: from the server when it
 * answered (so games played in other browsers show too), otherwise the ones
 * this browser saw. Earlier days', and games no crew of yours plays yet, are
 * kept (for syncing: joining a crew that plays it submits it then) but not listed.
 */
function renderResults(stored) {
  // e.g. "Results for Friday, November 20."
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("results-date").textContent = `Results for ${date}.`;
  const today = todaysPuzzles();
  const results = serverResults
    ? serverResults.map((r) => ({ game: r.game, result: r.result, sent: r.crews }))
    : Object.values(stored ?? {})
        .filter((r) => String(r.result?.puzzle) === today[r.game] && (r.crews ?? []).length > 0)
        .sort((a, b) => b.seenAt - a.seenAt)
        .map((r) => ({
          game: r.game,
          result: r.result,
          sent: (r.crews ?? []).filter((c) => c.outcome === "submitted" || c.outcome === "already").length,
        }));
  const list = document.getElementById("results");
  list.replaceChildren();
  for (const r of results.slice(0, 7)) {
    const { name, score } = describe(r.game, r.result);
    const sent = r.sent;
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
  doneToday = new Map(results.map((r) => [r.game, describe(r.game, r.result).score]));
  renderPlay();
  // Offered while any game Scrim reads by itself has no result today: the same
  // games the check looks for (see catchUp in background.js).
  const missing = AUTO_GAMES.filter(
    (g) => !Object.hasOwn(stored ?? {}, `${g}:${today[g]}`) && !results.some((r) => r.game === g),
  );
  document.getElementById("check-games-box").hidden = !CHECK_GAMES || missing.length === 0;
  return missing;
}

/** "Check my games" is off for now: it doesn't find Wordle games finished on another device yet. */
const CHECK_GAMES = false;

/** Games the extension reads from their pages. */
const AUTO_GAMES = [
  "wordle",
  "connections",
  "strands",
  "krillion",
  "contexto",
  "costcodle",
  "costcodleclassic",
  "poople",
  "minicrossword",
  "minicrosswordhard",
  "worldle",
  "globle",
  "waffle",
  "nerdle",
  "perceptle",
  "minecraftdle",
  "minecraftdleitem",
  "minecraftdlemob",
  "angledle",
];

/**
 * "Check my games": for games played elsewhere (e.g. on a phone) with the same
 * game accounts this browser is signed in to. The background worker opens each
 * game without a result today in a background tab, which loads the saved game
 * from the game's server, and its content script reports it as usual.
 */
function setUpCheckGames() {
  const button = document.getElementById("check-games");
  const text = document.getElementById("check-games-text");
  button.addEventListener("click", async () => {
    const before = renderResults((await chrome.storage.local.get("results")).results).length;
    button.disabled = true;
    button.textContent = "Checking…";
    await chrome.runtime.sendMessage({ type: "catch-up" }).catch(() => {});
    const after = renderResults((await chrome.storage.local.get("results")).results).length;
    button.disabled = false;
    button.textContent = "Check again";
    text.textContent =
      after < before ? "Found some. The rest aren't finished yet." : "No finished games detected.";
  });
}

const GAME_NAMES = {
  wordle: "Wordle",
  connections: "Connections",
  strands: "Strands",
  krillion: "Krillion",
  contexto: "Contexto",
  costcodle: "Costcodle Checkout",
  costcodleclassic: "Costcodle Classic",
  poople: "Poople",
  worldle: "Worldle",
  globle: "Globle",
  waffle: "Waffle",
  nerdle: "Nerdle",
  perceptle: "Perceptle",
  minecraftdle: "Minecraftdle (Block)",
  minecraftdleitem: "Minecraftdle (Item)",
  minecraftdlemob: "Minecraftdle (Mob)",
  angledle: "Angledle",
  minicrossword: "Mini Crossword (Easy)",
  minicrosswordhard: "Mini Crossword (Hard)",
};

/** Where each game is played (the same links as the site's). */
const GAME_URLS = {
  wordle: "https://www.nytimes.com/games/wordle/index.html",
  connections: "https://www.nytimes.com/games/connections",
  strands: "https://www.nytimes.com/games/strands",
  krillion: "https://krillion.io/",
  contexto: "https://contexto.me/en/",
  costcodle: "https://costcodle.com/",
  costcodleclassic: "https://costcodle.com/",
  poople: "https://poople.io/",
  worldle: "https://worldle.teuteuf.fr/",
  globle: "https://globle-game.com/",
  waffle: "https://wafflegame.net/daily",
  nerdle: "https://nerdlegame.com/",
  perceptle: "https://perceptle.com/",
  minecraftdle: "https://minecraftdle.com/blocks",
  minecraftdleitem: "https://minecraftdle.com/items",
  minecraftdlemob: "https://minecraftdle.com/mobs",
  angledle: "https://angledle.com/",
  minicrossword: "https://minicrossword.com/",
  minicrosswordhard: "https://minicrossword.com/hard",
};

/**
 * Modes of one game, which share a page (you switch modes on the game's own
 * page): the Play tab shows them as one link.
 */
const GAME_FAMILIES = {
  costcodle: { name: "Costcodle", url: "https://costcodle.com/" },
  costcodleclassic: { name: "Costcodle", url: "https://costcodle.com/" },
  minecraftdle: { name: "Minecraftdle", url: "https://minecraftdle.com/" },
  minecraftdleitem: { name: "Minecraftdle", url: "https://minecraftdle.com/" },
  minecraftdlemob: { name: "Minecraftdle", url: "https://minecraftdle.com/" },
  minicrossword: { name: "Mini Crossword", url: "https://minicrossword.com/" },
  minicrosswordhard: { name: "Mini Crossword", url: "https://minicrossword.com/" },
};

/** Rows per page in the Play tab, so the popup stays small. */
const PLAY_PAGE_SIZE = 5;
let playPage = 0;

/** The drawn ↗ (the character shows as an emoji on some systems), copied from the header. */
const ARROW = document.querySelector("#scrim-link .external-arrow");

document.getElementById("play-prev").addEventListener("click", () => {
  playPage--;
  renderPlay();
});
document.getElementById("play-next").addEventListener("click", () => {
  playPage++;
  renderPlay();
});

/** Today's score per game you've played, from the Results list. */
let doneToday = new Map();
/** The games your crews play ({ game, name, url }), once loaded: null until then. */
let crewGames = null;

/** Play tab: the games your crews play, with a link to each; not-yet-played first. */
async function loadPlay() {
  const reply = await chrome.runtime.sendMessage({ type: "games" }).catch(() => null);
  const rows = reply?.ok
    ? reply.rows
    : // Couldn't ask (offline, or an older server): every game Scrim knows.
      Object.keys(GAME_URLS).map((game) => ({ game }));
  // One row per game, holding the modes your crews play.
  const byKey = new Map();
  for (const r of rows) {
    const family = GAME_FAMILIES[r.game];
    const name = family?.name ?? r.game_name ?? GAME_NAMES[r.game];
    const url = family?.url ?? GAME_URLS[r.game] ?? safeUrl(r.url);
    if (!name || !url) continue;
    const key = family ? family.name : r.game;
    if (!byKey.has(key)) byKey.set(key, { name, url, modes: [] });
    byKey.get(key).modes.push(r.game);
  }
  crewGames = [...byKey.values()];
  if (reply && !reply.ok && reply.error === "not-connected") crewGames = [];
  renderPlay();
}

/** Only web links open from the popup (custom games' links are typed in by crew owners). */
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function renderPlay() {
  if (!crewGames) return;
  const list = document.getElementById("play");
  // A to Z, with games finished today (every mode) at the back.
  const done = (g) => g.modes.filter((m) => doneToday.has(m)).length;
  const allDone = (g) => done(g) === g.modes.length;
  const games = [...crewGames].sort((a, b) => Number(allDone(a)) - Number(allDone(b)) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(games.length / PLAY_PAGE_SIZE));
  playPage = Math.min(playPage, pages - 1);
  list.replaceChildren(
    ...games.slice(playPage * PLAY_PAGE_SIZE, (playPage + 1) * PLAY_PAGE_SIZE).map((g) => {
      const a = document.createElement("a");
      a.href = g.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      const name = document.createElement("span");
      name.className = "play-name";
      name.textContent = g.name;
      const state = document.createElement("span");
      state.className = "play-state muted";
      // Finished: a tick. Several modes, some played: how many are done.
      const n = done(g);
      if (allDone(g)) state.textContent = "✓";
      else if (n > 0) state.textContent = `✓ ${n}/${g.modes.length}`;
      else state.append("Play ", ARROW.cloneNode(true));
      if (allDone(g)) a.className = "done";
      a.append(name, state);
      const li = document.createElement("li");
      li.append(a);
      return li;
    }),
  );
  list.hidden = games.length === 0;
  document.getElementById("play-pager").hidden = pages === 1;
  document.getElementById("play-page").textContent = `${playPage + 1} / ${pages}`;
  document.getElementById("play-prev").disabled = playPage === 0;
  document.getElementById("play-next").disabled = playPage === pages - 1;
  const status = document.getElementById("play-status");
  status.hidden = games.length > 0;
  status.textContent = "Your crews aren't playing any games yet.";
}

/** Play / Results / Rankings tabs. Remembers the last tab, crew and game. */
function setUpTabs(view, scrimOrigin) {
  const tabs = {
    play: document.getElementById("tab-play"),
    results: document.getElementById("tab-results"),
    rankings: document.getElementById("tab-rankings"),
  };
  const panels = {
    play: document.getElementById("panel-play"),
    results: document.getElementById("panel-results"),
    rankings: document.getElementById("panel-rankings"),
  };
  let loaded = false;

  function select(name) {
    for (const key of Object.keys(tabs)) {
      tabs[key].setAttribute("aria-selected", String(key === name));
      panels[key].hidden = key !== name;
    }
    view.tab = name;
    save(view);
    // "Open Scrim": the crew on show in Rankings, otherwise the home page.
    const home = scrimOrigin ?? SCRIM_URL;
    document.getElementById("scrim-link").href = name === "rankings" && view.crew ? `${home}/crew/${view.crew}` : home;
    if (name === "rankings" && !loaded) {
      loaded = true;
      loadRankings(view, scrimOrigin);
    }
  }

  document.getElementById("tabs").hidden = false;
  for (const key of Object.keys(tabs)) tabs[key].addEventListener("click", () => select(key));
  loadPlay();
  select(Object.hasOwn(tabs, view.tab) ? view.tab : "results");
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
      ...[...games.entries()].map(
        ([g, players]) => new Option(PICKER_NAMES[g] ?? GAME_NAMES[g] ?? players[0]?.game_name ?? g, g),
      ),
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
        // Longest streak, lit up while it's still going. (Older servers only send the current one.)
        const best = p.max_streak ?? p.streak;
        const live = best > 0 && p.streak === best;
        const cells = [sharedRank(players, p), p.display_name, p.wins, p.played, best ? `${best}W` : "–"];
        for (const [i, value] of cells.entries()) {
          const td = document.createElement("td");
          if (i === 1) td.className = "name";
          if (i === 4 && live) {
            td.className = "streak-live";
            td.title = "Longest streak, still going";
          } else if (i === 4 && p.streak) {
            td.title = `Current streak: ${p.streak}W`;
          }
          td.textContent = String(value);
          tr.append(td);
        }
        return tr;
      }),
    );
    // The header's "Open Scrim" goes to the crew on show.
    if (view.tab === "rankings") document.getElementById("scrim-link").href = `${scrimOrigin ?? SCRIM_URL}/crew/${view.crew}`;
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

/**
 * Shorter names for the Rankings game picker, where the full names of games
 * with several modes don't fit. (The server names built-in games from their
 * ids, e.g. "Minicrosswordhard", so its names are only used for custom games.)
 */
const PICKER_NAMES = {
  costcodle: "Costco Checkout",
  costcodleclassic: "Costco Classic",
  minecraftdle: "MCdle (Block)",
  minecraftdleitem: "MCdle (Item)",
  minecraftdlemob: "MCdle (Mob)",
  minicrossword: "Mini (Easy)",
  minicrosswordhard: "Mini (Hard)",
};

/** Players with identical records share a rank, like on the site. */
function sharedRank(players, p) {
  return 1 + players.findIndex((o) => o.wins === p.wins && o.played === p.played);
}

function save(view) {
  chrome.storage.local.set({ popupView: view }).catch(() => {});
}

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1234 -> "$12.34". */
function formatCents(cents) {
  return `$${usd.format(cents / 100)}`;
}

function describe(game, result) {
  if (game === "connections") {
    // Same as the site: "0❌" to "3❌" for mistakes, "DNF" (did not finish) on the fourth.
    const score = !result.solved ? "DNF" : `${result.mistakes}❌`;
    return { name: "Connections", score };
  }
  if (game === "krillion") return { name: "Krillion", score: result.points.toLocaleString("en-US") };
  // Same as the site: "⭐" for no hints, "2💡" for two.
  if (game === "strands") return { name: "Strands", score: result.hints === 0 ? "⭐" : `${result.hints}💡` };
  if (game === "contexto") {
    // Same as the site: guesses (hints are counted in them), "DNF" for giving up.
    const score = !result.solved ? "DNF" : String(result.guesses);
    return { name: "Contexto", score };
  }
  // Same as the site: the total off, e.g. "$12.40".
  if (game === "costcodle") return { name: "Costcodle Checkout", score: formatCents(result.total) };
  if (game === "costcodleclassic") {
    return { name: "Costcodle Classic", score: `${result.solved ? result.guesses : "X"}/6` };
  }
  // Same as the site: the number of steps.
  if (game === "poople") return { name: "Poople", score: String(result.guesses) };
  if (game === "worldle") return { name: "Worldle", score: `${result.solved ? result.guesses : "X"}/6` };
  if (game === "globle") return { name: "Globle", score: String(result.guesses) };
  // Same as the site: "3⭐" for three swaps left, "X" for running out.
  if (game === "waffle") return { name: "Waffle", score: result.solved ? `${result.stars}⭐` : "X" };
  if (game === "nerdle") return { name: "Nerdle", score: `${result.solved ? result.guesses : "X"}/6` };
  // Same as the site: the day's score and its letter, e.g. "78 B".
  if (game === "perceptle") {
    const g = result.total >= 95 ? "S" : result.total >= 85 ? "A" : result.total >= 70 ? "B" : result.total >= 55 ? "C" : result.total >= 40 ? "D" : "F";
    return { name: "Perceptle", score: `${result.total} ${g}` };
  }
  // Same as the site: the number of tries.
  if (game === "minecraftdle" || game === "minecraftdleitem" || game === "minecraftdlemob") {
    return { name: GAME_NAMES[game], score: String(result.guesses) };
  }
  if (game === "angledle") return { name: "Angledle", score: `${result.solved ? result.guesses : "X"}/6` };
  // Same as the site: "1:23", "45s", "+2💡" for reveals.
  if (game === "minicrossword" || game === "minicrosswordhard") {
    const m = Math.floor(result.seconds / 60);
    const s = result.seconds % 60;
    const time = m === 0 ? `${s}s` : `${m}:${String(s).padStart(2, "0")}`;
    return { name: GAME_NAMES[game], score: result.reveals ? `${time} +${result.reveals}💡` : time };
  }
  return { name: "Wordle", score: `${result.solved ? result.guesses : "X"}/6` };
}
