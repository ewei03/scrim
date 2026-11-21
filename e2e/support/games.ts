import type { BrowserContext } from "@playwright/test";

/**
 * Stand-ins for the games' own websites. The extension's content scripts run
 * on the real addresses (nytimes.com, krillion.io), so the tests answer those
 * addresses themselves: no real NYT account or puzzle answer needed, and the
 * tests don't depend on those sites.
 *
 * The Wordle page writes the same saved state NYT's game writes to
 * localStorage, which is what the extension reads.
 */

export const WORDLE_URL = "https://www.nytimes.com/games/wordle/index.html";

/** Today's date where the tests run (the browser, the extension and the crew all use it). */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's Wordle number. */
export function todaysWordle(d = new Date()) {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2021, 5, 19)) / 86_400_000);
}

/** Share text for today's Wordle, solved in 3 (crane, cloth, clout). */
export function wordleShareText(puzzle = todaysWordle()) {
  return `Wordle ${puzzle.toLocaleString("en-US")} 3/6\n\n🟩⬛⬛⬛⬛\n🟩🟩🟩🟨⬛\n🟩🟩🟩🟩🟩`;
}

export type WordlePlay = {
  /** Signed in to NYT (counted) or not (the extension says it doesn't count). */
  signedIn: boolean;
  status: "WIN" | "FAIL" | "IN_PROGRESS";
};

/** What the stand-in Wordle page shows; change it, then (re)load the page. */
export class FakeGames {
  wordle: WordlePlay | null = null;

  async install(context: BrowserContext) {
    await context.route("https://www.nytimes.com/**", (route) => {
      const url = route.request().url();
      if (route.request().resourceType() !== "document") return route.fulfill({ status: 204 });
      if (url.includes("/games/wordle")) return route.fulfill({ contentType: "text/html", body: this.wordlePage() });
      return route.fulfill({ contentType: "text/html", body: page("NYT Games (test stand-in)", "") });
    });
    await context.route("https://krillion.io/**", (route) =>
      route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: page("Krillion (test stand-in)", "") })
        : route.fulfill({ status: 204 }),
    );
  }

  private wordlePage() {
    const play = this.wordle;
    const guesses = play?.status === "FAIL" ? ["audio", "pious", "tempo", "dumpy", "fight", "brick"] : ["crane", "cloth", "clout"];
    const state = play && {
      states: [
        {
          puzzleId: "1555",
          printDate: localDate(),
          data: {
            boardState: [...guesses, ...Array(6 - guesses.length).fill("")],
            currentRowIndex: guesses.length,
            status: play.status,
            hardMode: false,
            isPlayingArchive: false,
          },
          schemaVersion: "0.52.0",
        },
      ],
    };
    const key = `games-state-wordleV2/${play?.signedIn ? "123456789" : "ANON"}`;
    const script = `
      for (const k of Object.keys(localStorage)) if (k.startsWith("games-state-wordleV2")) localStorage.removeItem(k);
      ${state ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))});` : ""}
    `;
    const body = play
      ? `<p id="status">Wordle: ${play.status} · ${play.signedIn ? "signed in to NYT" : "signed out of NYT"}</p>`
      : `<p id="status">Wordle: not played yet</p>`;
    return page("Wordle (test stand-in)", body, script);
  }
}

function page(title: string, body: string, script = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<script>${script}</script></head>
<body style="font:16px system-ui;padding:2rem"><h1>${title}</h1>${body}</body></html>`;
}
