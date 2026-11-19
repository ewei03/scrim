# Scrim

Daily puzzle showdowns with friends. Create a crew, open a lobby for today's
puzzle, share the link, everyone plays on their own time, and the lobby crowns
a winner. Persistent rankings, head-to-head records and an archive live on the
crew.

**v0.1 games:** Wordle (paste your share text, or enter manually).
Only free-to-play games are supported — `GameAdapter.free` is typed `true`.

## How it fits together

| Concept | Lifetime | Notes |
|---|---|---|
| **Crew** | permanent | Friend group. Rankings, h2h, archive. Link: `/c/<code>` |
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
- `src/lib/stats.ts` — rankings, streaks, recent form, head-to-head
- `src/app/` — `/` home, `/c/[code]` crew, `/l/[code]` lobby, `/me` profile

### Adding a game

1. Write an adapter in `src/games/<game>.ts` (parse share text, compare, format).
2. Register it in `src/games/registry.ts` and add its grid/manual UI to `src/games/ui.tsx`.
3. Add a branch to `normalize_result` and `is_supported_game` in a new migration.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run each file in `supabase/migrations/` in order (`0001_init.sql`, then `0002_table_grants.sql`).
3. **Authentication → Sign In / Providers:**
   - enable **Allow anonymous sign-ins** (guest play)
   - enable **Allow manual linking** (lets guests attach Google later)
   - enable **Google** with an OAuth client ID/secret from Google Cloud Console
     (redirect URI: `https://<project>.supabase.co/auth/v1/callback`)
4. **Authentication → URL Configuration:** set the Site URL and add
   `http://localhost:3000/**` (and your production URL) to Redirect URLs.
5. `cp .env.example .env.local` and fill in the project URL and publishable key.
6. `npm install && npm run dev`

## Scripts

- `npm run dev` — dev server
- `npm test` — unit tests plus schema tests (runs the real migration in an
  in-memory Postgres via PGlite, with a stub of Supabase's auth schema)
- `npm run lint`, `npm run typecheck`, `npm run build`

## Roadmap

- v0.2 Connections adapter
- v0.3 Krillion adapter + Chrome extension for automatic score capture
