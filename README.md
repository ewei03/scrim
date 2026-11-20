# Scrim

Daily puzzle showdowns with friends. Create a crew, pick the games it plays,
share the link, and everyone plays each day's puzzle on their own time. Each
day crowns a winner; rankings and every past day live on the crew.

**Games:** Wordle, NYT Connections and Krillion, today's puzzle only. Desktop Chrome only.

Results get in automatically through the **Scrim Chrome extension**: play
Wordle or Connections on nytimes.com, or Krillion on krillion.io, as usual, and when you finish, the extension reads the
result from the page and submits it to every crew you're in that plays that
game. Pasting the share text is the
fallback.
Only free-to-play games are supported — `GameAdapter.free` is typed `true`.

## How it fits together

| Concept | Lifetime | Notes |
|---|---|---|
| **Crew** | permanent | Friend group. Picks its games, time zone and rules. Rankings, past days. Link: `/crew/<code>` |
| **Round** | one game, one puzzle, one crew | Started by the first result. Closes at midnight in the crew's time zone (New York for Krillion) |
| **Entry** | one per player per round | Validated server-side; source is `extension`, or `paste` as the fallback |

- Opening the invite link joins the crew. Members can leave; the owner can remove (and ban) them.
- Ties share the win (two people who both get Wordle in 1 both win). A miss can't win.
- Spoiler protection: with "hide scores until you submit" on, other players'
  results stay masked until you lock yours in (enforced by row-level security).
- The crew owner can void entries.

### Code map

- `supabase/migrations/` — tables, RLS, and the RPCs all writes go through (`0009_daily_rounds.sql` has the current crew/round model)
- `src/games/` — game adapters (`wordle.ts`), registry, ranking, game-specific UI
- `src/lib/stats.ts` — rankings and streaks
- `src/lib/rounds.ts` — which puzzle is a crew's "today", and when its day ends
- `src/app/` — `/` home, `/crew/[code]` crew (old `/c/…` links redirect), `/profile` (was `/me`), `/privacy`
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
  The server validates the result and enters it into every crew you're in
  that plays the game, starting the day's round if you're first. Results are
  also kept locally, so joining a crew (or a crew adding the game) *after* you
  played still gets your score in when you open the crew page.
- The popup has a **Rankings** tab: `extension_rankings` (in `0009_daily_rounds.sql`)
  returns each crew's rankings for the token's user. It ranks in SQL, so its
  `result_points` / `result_can_win` must match each game's `compare` /
  `canWin` (a schema test checks this).
- `scrim-bridge.js` runs on the Scrim site so the page can talk to the
  extension (connect, disconnect, status, sync) through `window.postMessage`.
- Connecting (Profile → Chrome extension) mints a random token (stored hashed;
  `0003_extension.sql`). The extension never holds your login session.
  Disconnect revokes it.

### Adding a game

1. Write an adapter in `src/games/<game>.ts` (parse share text, compare, format).
2. Register it in `src/games/registry.ts` and add its grid UI to `src/games/ui.tsx`.
3. Add a branch to `normalize_result`, `is_supported_game` and `is_todays_puzzle` in a new migration.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run each file in `supabase/migrations/` in order
   (`0001_init.sql` through `0009_daily_rounds.sql`).
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

Game suggestions (footer → Suggest a game) land in the `game_suggestions` table.
Only you can read them: open **Table Editor → game_suggestions** in the Supabase
dashboard. The app can write suggestions but can't read them back.

When Scrim gets a real domain, add it to the `scrim-bridge.js` `matches` in
`extension/manifest.json` (it currently matches `localhost` only).

## Scripts

- `npm run dev` — dev server
- `npm test` — unit tests plus schema tests (runs the real migration in an
  in-memory Postgres via PGlite, with a stub of Supabase's auth schema)
- `npm run lint`, `npm run typecheck`, `npm run build`

## Roadmap

- Archive puzzles (past days); today only for now
- v0.2 Connections adapter
- v0.3 Krillion adapter (extension content script + adapter)
