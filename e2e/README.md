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
2. **Test accounts.** Many tests need two regular (non-guest) accounts: a
   guest can't make crews, and invites need a second person.
   Google accounts can't be signed into by a test, so these are email +
   password accounts, which the site treats the same way.
   - Supabase → Authentication → Sign In / Providers: make sure **Email** is
     enabled (needed for password sign-in).
   - Supabase → Authentication → Users → **Add user → Create new user**, twice
     (e.g. `scrim-e2e-owner@example.com`, `scrim-e2e-friend@example.com`), with
     **Auto Confirm User** ticked. Use throwaway passwords.
   - Copy `.env.test.example` to `.env.test.local` and fill them in.

   Without them, those tests are skipped and the rest (the guest-only ones)
   still run.
3. **Optional: a separate test project.** By default the tests use the
   Supabase project in `.env.local`, which is usually the live one. To keep
   test rows out of it, make a second Supabase project, run every file in
   `supabase/migrations/` on it, turn on anonymous sign-ins and Email there,
   make the two test users there, and set `E2E_SUPABASE_URL` and
   `E2E_SUPABASE_PUBLISHABLE_KEY` in `.env.test.local`. The tests then start
   their own dev server against it (stop yours first: with a test project they
   won't reuse one, so they can't quietly hit the live project), and load a
   copy of the extension that's allowed to talk to it.

## What they touch

They run against the Supabase project in `.env.local` (or the test project,
above), so they create real rows there. All of it cleans itself up:

- The test accounts' crews are deleted after each test, and at the start of
  each run in case one stopped part-way.
- Each run makes about 20 guest accounts. They don't own crews, and once the
  test accounts' crews are gone they have nothing left, so the cleanup deletes
  them a day after they were made (0020).
- Supabase limits anonymous sign-ins (30 an hour per IP by default; Supabase →
  Authentication → Rate Limits), so running the whole suite more than once in
  an hour can hit it: tests then fail with "Request rate limit reached".
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
| `guest.spec.ts` | Sign in as guest: blank name refused, a name works, signing out |
| `guest-crew.spec.ts` | Guests can't make crews; a guest joins one by pasting its invite link on the home page (a bad link is refused) |
| `crew-full.spec.ts` | The 11th person to open an invite link is told the crew is full (10 players) |
| `crew-rules.spec.ts` | Approving new members: the invite link asks, the owner approves or declines |
| `google.spec.ts` | Google sign-in opens Google in a pop-up (up to Google's own page); guests can link Google |
| `navigation.spec.ts` | Help, theme toggle, Suggest a game (× / outside click / Escape), GitHub, @eggnonk, Privacy & Terms, old URLs |
| `crew.spec.ts` | Create, invite (friend + guest), duplicate names refused, settings (rename, hide scores, time zone, remove member), games (built-in + custom), delete, leave |
| `extension.spec.ts` | Finishing a game: not connected, connected (straight into the crew), played signed out of NYT, unfinished, played before the crew picked the game, extension popup |
| `extension-autoconnect.spec.ts` | Signing in connects the extension by itself; signing out disconnects it |
| `manual.spec.ts` | Pasting results (invalid ones refused, wrong day, a good one), hidden scores, voiding, custom game scores |
| `midnight.spec.ts` | The crew's day rolling over at midnight (faked browser clock): results move to the archive, rankings update, a new day starts |
| `welcome.spec.ts` | The welcome guide: new guests only, first visit only, never again, never for Google accounts |

Signing in to Google itself isn't automated: Google blocks automated
browsers, and a test shouldn't hold a real Google password.
