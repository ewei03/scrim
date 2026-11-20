# Scrim

Daily puzzle showdowns with friends. Create a crew, open a lobby for today's
puzzle, share the link, everyone plays on their own time, and the lobby crowns
a winner. Persistent rankings and an archive live on the
crew.

**Games:** Wordle, NYT Connections and Krillion, today's puzzle only. Desktop Chrome only.

Results get in automatically through the **Scrim Chrome extension**: play
Wordle or Connections on nytimes.com, or Krillion on krillion.io, as usual, and when you finish, the extension reads the
result from the page and submits it to every open lobby for that puzzle in
your crews. Pasting the share text, or entering the score by hand, is a
fallback.
Only free-to-play games are supported — `GameAdapter.free` is typed `true`.

## How it fits together

| Concept | Lifetime | Notes |
|---|---|---|
| **Crew** | permanent | Friend group. Rankings, archive. Link: `/c/<code>` |
| **Lobby** | one game, one puzzle | Closes at its deadline (or when the host closes it). Link: `/l/<code>` |
| **Entry** | one per player per lobby | Validated server-side; source is `paste`, `manual` or (later) `extension` |

- Opening any invite link joins the crew.
- Ties share the win (two people who both get Wordle in 1 both win). A miss can't win.
- Spoiler protection: with "hide scores until you submit" on, other players'
  results stay masked until you lock yours in (enforced by row-level security).
- The host can void entries and close a lobby early.

### Code map

- `supabase/migrations/0001_init.sql` — tables, RLS, and the RPCs all writes go through
- `src/games/` — game adapters (`wordle.ts`), registry, ranking, game-specific UI
- `src/lib/stats.ts` — rankings, streaks, recent form
- `src/app/` — `/` home, `/c/[code]` crew, `/l/[code]` lobby, `/me` profile
- `extension/` — Chrome extension (plain JS, no build step)

### How the extension works

- `nyt-wordle.js` runs on the Wordle page and polls NYT's saved game state
  (`localStorage["games-state-wordleV2/…"]`). When a game is WIN or FAIL (and
  not an archive puzzle), it reads the coloured tiles off the board, builds a
  result and hands it to `background.js`. The puzzle number comes from the
  state's `printDate` (NYT's own `puzzleId` is an internal number).
- `nyt-connections.js` does the same on the Connections page
  (`localStorage["games-state-connections/…"]`). Each saved guess is
  `{ cards: "3,7,12,15", correct }`; the game counts as over at four correct
  or four wrong guesses (the saved `puzzleComplete` can lag behind). Colours
  come from the day's puzzle file, `/svc/connections/v2/<date>.json`, where a
  card's level is its category's index.
- `krillion.js` runs on krillion.io and reads finished Daily Dives from
  `localStorage["krillion:stats:v1"]` (prefixed `krillion:account:<id>:` when
  signed in). Archive, Unlimited and pack dives are ignored.
- NYT games only count when played signed in to NYT: saves under
  `…/ANON` (signed out) are ignored, and the page shows a notice instead.
- `scrim-content.js` is the shared watch-and-notify loop the game scripts use.
- Games finished *before* the extension was connected: on install/update,
  `background.js` injects the content scripts into tabs that were already
  open. On connect, for each game with no result for today's puzzle, it reads
  the game's open tab or opens the page in a background tab for up to 20 s,
  then closes it.
- `background.js` calls the `extension_submit` RPC with the extension's token.
  The server validates the result and enters it into every open lobby for
  that puzzle in your crews. Results are also kept locally, so a lobby created
  *after* you played still gets your score when you open it.
- `scrim-bridge.js` runs on the Scrim site so the page can talk to the
  extension (connect, disconnect, status, sync) through `window.postMessage`.
- Connecting (Profile → Chrome extension) mints a random token (stored hashed;
  `0003_extension.sql`). The extension never holds your login session.
  Disconnect revokes it.

### Adding a game

1. Write an adapter in `src/games/<game>.ts` (parse share text, compare, format).
2. Register it in `src/games/registry.ts` and add its grid/manual UI to `src/games/ui.tsx`.
3. Add a branch to `normalize_result`, `is_supported_game` and `is_todays_puzzle` in a new migration.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run each file in `supabase/migrations/` in order
   (`0001_init.sql` through `0007_reopen_empty_lobbies.sql`).
3. **Authentication → Sign In / Providers:**
   - enable **Allow anonymous sign-ins** (guest play)
   - enable **Allow manual linking** (lets guests attach Google later)
   - enable **Google** with an OAuth client ID/secret from Google Cloud Console
     (redirect URI: `https://<project>.supabase.co/auth/v1/callback`)
4. **Authentication → URL Configuration:** set the Site URL and add
   `http://localhost:3000/**` (and your production URL) to Redirect URLs.
5. `cp .env.example .env.local` and fill in the project URL and publishable key.
6. `npm install && npm run dev`, then open http://localhost:3000
7. Install the extension: `chrome://extensions` → turn on **Developer mode** →
   **Load unpacked** → pick the `extension/` folder. Then in Scrim go to
   **Profile → Chrome extension → Connect extension**.

When Scrim gets a real domain, add it to the `scrim-bridge.js` `matches` in
`extension/manifest.json` (it currently matches `localhost` only).

## Scripts

- `npm run dev` — dev server
- `npm test` — unit tests plus schema tests (runs the real migration in an
  in-memory Postgres via PGlite, with a stub of Supabase's auth schema)
- `npm run lint`, `npm run typecheck`, `npm run build`

## Roadmap

- Archive puzzles (lobbies for past days); today only for now
- v0.2 Connections adapter
- v0.3 Krillion adapter (extension content script + adapter)
