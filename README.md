# Scrim

Daily puzzle showdowns with friends. Start a crew, pick the games it plays and
share the invite. Everyone plays each day's puzzle on their own time, each day
crowns a winner, and the crew keeps rankings and every past day.

**Games:** Wordle, NYT Connections and Krillion, today's puzzle only. Desktop
Chrome only. Only free-to-play games are supported (`GameAdapter.free` is typed
`true`).

Results get in automatically through the **Scrim Chrome extension**: play the
game on its own site as usual, and when you finish, the extension reads the
result from the page and submits it to every crew you're in that plays that
game. Pasting the game's share text is the fallback; scores can't be typed in.

## How it works

| Concept | Lifetime | Notes |
|---|---|---|
| **Crew** | permanent | Friend group. The owner picks its games, time zone and spoiler setting. Rankings and past days. Link: `/crew/<code>` |
| **Round** | one crew, one game, one puzzle | Nobody creates it: the first result for that puzzle starts it. Closes at midnight in the crew's time zone (New York time for Krillion) |
| **Entry** | one per player per round | Validated server-side. Source is `extension`, or `paste` as the fallback |

- **Joining:** opening a crew's invite link joins it, unless someone in the
  crew already has your display name (ignoring case); renaming yourself to a
  name taken in one of your crews is refused too. Members can leave; the
  owner can remove members, which also bans them from rejoining.
- **Games:** the owner turns games on and off right in the crew box on the
  crew page. Turning one off keeps its past days and rankings.
- **Time zone:** a new crew takes its creator's time zone. Crews from before
  time zones existed get the owner's the next time they open the crew page.
  The owner can change it under ⚙ Manage crew.
- **Custom games:** for daily games Scrim doesn't integrate, the owner adds
  a custom game (crew box → "+ Custom"): name, link, instructions, colour,
  score type (points, time or attempts) and its format, which way wins, and
  whether "didn't finish" is allowed. Scores are typed in by hand, on the
  honour system. Scoring locks once anyone has entered a score.
- **Guests:** a guest account is removed from a crew, with its scores there,
  a day after joining (hourly, via pg_cron). Linking Google makes it a regular
  account that stays. Guests show as "(guest)" in the crew box, and can't
  create crews; they join with invite links.
- **Winning:** ties share the win (two people who both get Wordle in 1 both
  win). A miss can't win.
- **Spoiler protection:** with "hide scores until you submit" on, other
  players' results stay masked until you lock yours in (enforced by
  row-level security).
- **Owner controls:** rename the crew, void entries, remove members, change
  settings, delete the crew.

### Around the site

- **Home:** a Today list of every game in every crew you're in (unplayed
  first), your crews, and a form to create a crew.
  First-time players get a welcome guide that ticks off each setup step.
- **Crew page:** a card per game for today, colour-coded and collapsible, with
  the time left, your submit panel and the live scoreboard. Then rankings and
  past days (click a day to see its full scoreboard).
- **Profile:** display name, the extension connection, and linking a guest
  account to Google.
- **Footer:** Suggest a game (with an optional contact email) and Privacy &
  Terms.
- Old URLs redirect: `/c/<code>` → `/crew/<code>`, `/me` → `/profile`.

## Code map

- `supabase/migrations/` — tables, RLS and the RPCs every write goes through.
  `0009_daily_rounds.sql` has the current model: crews, tracked games, rounds,
  entries, extension rankings and suggestion emails.
- `supabase/schema.test.ts` — runs every migration in an in-memory Postgres
  and exercises the RPCs and RLS as different users.
- `src/games/` — one adapter per game (parsing share text, scoring, colour),
  the registry, ranking, and game-specific UI (`ui.tsx`).
- `src/lib/rounds.ts` — which puzzle is a crew's "today", and when its day ends.
- `src/lib/stats.ts` — rankings and streaks.
- `src/app/` — `/` home, `/crew/[code]` crew, `/profile`, `/privacy`
  (Privacy & Terms). `icon.svg` is the favicon.
- `public/logo.svg` — the logo.
- `extension/` — Chrome extension (plain JS, no build step).

## The extension

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
- NYT games only count when played signed in to NYT: saves under `…/ANON`
  (signed out) are ignored, and the page shows a notice instead.
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
- The popup lists recent results and has a **Rankings** tab, backed by the
  `extension_rankings` RPC. That ranks in SQL, so its `result_points` /
  `result_can_win` must match each game's `compare` / `canWin` (a schema test
  checks this).
- `scrim-bridge.js` runs on the Scrim site so the page can talk to the
  extension (connect, disconnect, status, sync) through `window.postMessage`.
- Connecting (Profile → Chrome extension) mints a random token, stored hashed
  (`0003_extension.sql`). The extension never holds your login session.
  Disconnecting revokes it.
- Icons in `extension/icons/` are PNGs rendered from `public/logo.svg`;
  re-render them if the logo changes.

## Adding a game

1. Write an adapter in `src/games/<game>.ts`: parse share text, compare,
   format, a `color`, `puzzleForDate`, and `zone` if it resets at one moment
   worldwide.
2. Register it in `src/games/registry.ts` and add its grid UI to
   `src/games/ui.tsx`.
3. In a new migration, add branches to `normalize_result`,
   `is_supported_game`, `is_todays_puzzle`, `puzzle_date`, `result_points` and
   `result_can_win` (and to `round_closes_at` if it has a fixed time zone).
4. For auto-submit: a content script in `extension/` and its `manifest.json`
   entry, a `CATCH_UP` entry in `background.js`, and its name and score format
   in `popup.js`.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run each file in `supabase/migrations/` in order
   (`0001_init.sql` through `0013_guests_cant_create_crews.sql`). Before `0012`, enable the
   **pg_cron** extension (Database → Extensions) so guests are cleaned up hourly. `0009` replaces the old
   lobbies and **erases any lobby results**; afterwards each crew owner picks
   their crew's games on the crew page.
3. **Authentication → Sign In / Providers:**
   - enable **Allow anonymous sign-ins** (guest play)
   - enable **Allow manual linking** (lets guests attach Google later)
   - enable **Google** with an OAuth client ID/secret from Google Cloud Console
     (redirect URI: `https://<project>.supabase.co/auth/v1/callback`). Also
     paste the same client ID into the provider's **Client IDs** field, so
     Supabase accepts tokens from Google's sign-in button.
   - In Google Cloud → that OAuth client → **Authorized JavaScript origins**,
     add `http://localhost:3000` and your production URL. Google's button only
     works on those origins, and its prompt names that address instead of the
     Supabase project.
4. **Authentication → URL Configuration:** set the Site URL and add
   `http://localhost:3000/**` (and your production URL) to Redirect URLs.
   Linking Google returns to `/profile`, so a wildcard is simplest.
5. `cp .env.example .env.local` and fill in the project URL, publishable key
   and Google client ID (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Without the client
   ID, Google sign-in falls back to Supabase's redirect flow, which shows the
   Supabase address.
6. `npm install && npm run dev`, then open http://localhost:3000
7. Install the extension: `chrome://extensions` → turn on **Developer mode** →
   **Load unpacked** → pick the `extension/` folder. Then in Scrim go to
   **Profile → Chrome extension → Connect extension**. Reload it there after
   pulling extension changes.

Game suggestions land in the `game_suggestions` table, with the sender's
optional email. Only you can read them: open **Table Editor →
game_suggestions** in the Supabase dashboard. The app can write suggestions
but can't read them back.

The extension talks to the live site (`https://daily-scrim.vercel.app`) and,
for development, `localhost`; both are in `extension/manifest.json`, along with
the Supabase project. If the domain or project changes, update them there.

### Publishing the extension

`npm run ext:zip` builds `dist/scrim-extension-<version>.zip` for the Chrome
Web Store: the `extension/` files without tests and type declarations, and
with `localhost` removed from the manifest. Bump `version` in
`extension/manifest.json` before each upload.

## Scripts

- `npm run dev` — dev server
- `npm test` — unit tests plus schema tests
- `npm run lint`, `npm run typecheck`, `npm run build`

## Roadmap

- Publish the extension on the Chrome Web Store
- Archive puzzles (past days); today only for now
- More games (see the suggestions table)
