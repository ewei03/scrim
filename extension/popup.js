(async () => {
  const c = await chrome.storage.local.get(["token", "displayName", "results"]);
  const status = document.getElementById("status");
  if (c.token) {
    status.textContent = `⚡ Connected as ${c.displayName ?? "you"}`;
    status.classList.remove("muted");
  } else {
    status.textContent = "Not connected. Open Scrim, go to Profile, and click Connect extension.";
  }

  const results = Object.values(c.results ?? {}).sort((a, b) => b.seenAt - a.seenAt);
  const list = document.getElementById("results");
  for (const r of results.slice(0, 7)) {
    const { name, score } = describe(r.game, r.result);
    const sent = r.lobbies.filter((l) => l.outcome === "submitted" || l.outcome === "already").length;
    const left = document.createElement("span");
    left.textContent = `${name} #${Number(r.result.puzzle).toLocaleString("en-US")} · ${score}`;
    const right = document.createElement("span");
    right.className = "muted";
    right.textContent = sent ? `${sent} ${sent === 1 ? "lobby" : "lobbies"}` : "waiting";
    const li = document.createElement("li");
    li.append(left, right);
    list.append(li);
  }
  list.hidden = results.length === 0;
})();

function describe(game, result) {
  if (game === "connections") {
    const score = !result.solved
      ? `X · ${result.groups}/4`
      : result.mistakes === 0
        ? "Perfect"
        : `${result.mistakes} mistake${result.mistakes === 1 ? "" : "s"}`;
    return { name: "Connections", score };
  }
  if (game === "krillion") return { name: "Krillion", score: `${(result.points * 10).toLocaleString("en-US")} m` };
  return { name: "Wordle", score: `${result.solved ? result.guesses : "X"}/6` };
}
