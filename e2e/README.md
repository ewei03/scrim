# Browser tests (Playwright)

End-to-end tests that drive a real Chromium window through Scrim, with the
Scrim extension loaded. You can watch them run.

```sh
npm run e2e          # run everything, browser visible
npm run e2e:ui       # Playwright's UI: pick tests, watch them step by step, time-travel
npm run e2e -- crew  # only files matching "crew"
npm run e2e:report   # open the last run's report (failures have a video and a trace)
```

- `E2E_SLOWMO=400 npm run e2e` slows every step down so it's easier to follow.
- `E2E_HEADLESS=1 npm run e2e` hides the browser.

The tests start `npm run dev` themselves, or reuse one already running on
port 3000. Open the site as `localhost`, not `127.0.0.1`.

## One-time setup

1. `npx playwright install chromium`
2. **Test accounts.** Most tests need two regular (non-guest) accounts: crews
   can only be made by regular accounts, and invites need a second person.
   Google accounts can't be signed into by a test, so these are email +
   password accounts, which the site treats the same way.
   - Supabase → Authentication → Sign In / Providers: make sure **Email** is
     enabled (needed for password sign-in).
   - Supabase → Authentication → Users → **Add user → Create new user**, twice
     (e.g. `scrim-e2e-owner@example.com`, `scrim-e2e-friend@example.com`), with
     **Auto Confirm User** ticked. Use throwaway passwords.
   - Copy `.env.test.example` to `.env.test.local` and fill them in.

   Without them, those tests are skipped and the rest still run.

## What they touch

They run against the Supabase project in `.env.local`, so they create real
rows there:

- The test accounts' crews are deleted after each test, and at the start of
  each run in case one stopped part-way.
- Each run makes a handful of guest accounts. Guests leave crews after a day
  (0012), but the accounts stay in Authentication → Users; delete them there
  if you like. Supabase limits anonymous sign-ins (30 an hour by default), so
  running the whole suite many times in an hour can hit that.
- "Suggest a game" is tested with the request answered by the test, so no
  suggestion is stored and the 1-hour cooldown isn't started.

## The game sites

The extension tests don't use the real nytimes.com or krillion.io. The tests
answer those addresses with stand-in pages (`support/games.ts`) that save a
finished game in localStorage exactly like NYT's Wordle does, so the real
extension, content scripts and background worker run unchanged, without an
NYT account or knowing today's answer.

## What's covered

| File | |
| --- | --- |
| `guest.spec.ts` | Play as guest: blank name refused, a name works, signing out |
| `google.spec.ts` | Google sign-in opens Google in a pop-up (up to Google's own page); guests can link Google |
| `navigation.spec.ts` | Help, theme toggle, Suggest a game (× / outside click / Escape), GitHub, @eggnonk, Privacy & Terms, old URLs |
| `crew.spec.ts` | Create, invite (friend + guest), duplicate names refused, settings (rename, hide scores, time zone, remove member), games (built-in + custom), delete, leave |
| `extension.spec.ts` | Finishing a game: not connected, connected (straight into the crew), signed out of NYT, unfinished, played before the crew picked the game, extension popup |
| `manual.spec.ts` | Pasting results (invalid ones refused, wrong day, a good one), hidden scores, voiding, custom game scores |
| `welcome.spec.ts` | The welcome guide: first visit only, never again, never for older accounts or guests |

Signing in to Google itself isn't automated: Google blocks automated
browsers, and a test shouldn't hold a real Google password.
