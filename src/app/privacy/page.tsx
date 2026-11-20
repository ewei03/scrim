import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy & Terms — Scrim" };

const ISSUES = "https://github.com/ewei03/scrim/issues";

export default function PrivacyPage() {
  return (
    <article className="stack prose">
      <h1>Privacy &amp; Terms</h1>
      <p className="muted small">Last updated November 20, 2026</p>
      <p>
        Scrim is a small hobby project for playing daily puzzles with friends. It collects only what it needs to run
        crews and keep score. Using Scrim means you agree to the terms below.
      </p>
      <nav className="row small" aria-label="On this page">
        <a href="#privacy">Privacy</a>
        <a href="#terms">Terms of use</a>
      </nav>

      <h2 id="privacy">Privacy</h2>

      <h3>What Scrim stores</h3>
      <ul>
        <li>
          <strong>Your account:</strong> a display name. If you sign in with Google, your Google account&apos;s email
          address and name, as provided by Google sign-in.
        </li>
        <li>
          <strong>Your crews:</strong> which crews you belong to, the crews you create, and their games and
          settings.
        </li>
        <li>
          <strong>Your results:</strong> your score for each daily puzzle in each crew, the coloured grid, the share
          text if you pasted it or the extension submitted it, whether it was entered automatically or pasted, and
          when.
        </li>
        <li>
          <strong>Extension connection:</strong> if you connect the Chrome extension, a hashed copy of its access key
          and when it was last used.
        </li>
        <li>
          <strong>Game suggestions:</strong> if you suggest a game, what you wrote, which account sent it, and the
          email address you gave, if any. That address is only used to reply about your suggestion.
        </li>
      </ul>
      <p>
        Scrim never sees your guessed words. Results only contain your score, the colour pattern and the puzzle
        number.
      </p>

      <h3>Who can see it</h3>
      <p>
        Your display name and results are visible to the other members of your crews. While a puzzle&apos;s day is
        still on and &quot;hide scores until you submit&quot; is on, other players can&apos;t see your result until
        they&apos;ve submitted their own. Game suggestions are only visible to Scrim&apos;s maintainer.
      </p>

      <h3>The Chrome extension</h3>
      <ul>
        <li>
          It only runs on the Scrim website and the affiliated games for collecting score data.
          It doesn&apos;t read any other site or your browsing history.
        </li>
        <li>
          On each game&apos;s page it reads the progress the game saves in your browser once a game is finished. From that it sends Scrim your score, the colour grid or answer
          rarity, and the puzzle number. It never sends your guesses or answers themselves.
        </li>
        <li>
          When you connect it, it checks whether you already finished today&apos;s puzzles. For any game whose page
          isn&apos;t open, it opens that page in a background tab for a few seconds to read the result, then closes it.
        </li>
        <li>
          The Rankings tab loads your crews&apos; rankings from Scrim using its access key. They&apos;re shown in the
          popup, not stored.
        </li>
        <li>
          It keeps your recent results, its connection details and which rankings you last viewed in the
          extension&apos;s own storage on your computer. Disconnecting it from your profile revokes its access key.
        </li>
      </ul>

      <h3>Where it&apos;s stored</h3>
      <p>
        Scrim&apos;s data is stored with Supabase. Your browser keeps your login session,
        your light/dark mode preference and whether you&apos;ve seen the welcome guide in local storage. Guest
        accounts exist only in that browser.
      </p>

      <h3>What Scrim doesn&apos;t do</h3>
      <ul>
        <li>
          No ads, no analytics or tracking scripts. The only outside script is Google&apos;s sign-in button, on the
          pages where you sign in or link a Google account.
        </li>
        <li>Your data is never sold or shared with anyone outside your crews.</li>
      </ul>

      <h3>Deleting your data</h3>
      <p>
        Leaving a crew removes your results for the current day from it; earlier days stay in the crew&apos;s history.
        To have your account and all your results deleted, open an issue on{" "}
        <a href={ISSUES} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>

      <h2 id="terms">Terms of use</h2>

      <h3>Using Scrim</h3>
      <p>
        Scrim is completely free. You can use it as a guest or with a Google account. You&apos;re responsible
        for what happens on your account, and for keeping your Google account secure.
      </p>

      <h3>Play fair!</h3>
      <p>We don&apos;t enforce these rules, but an honest system keeps things fair and fun.</p>
      <ul>
        <li>Only submit results from puzzles you played yourself, on your own account.</li>
        <li>
          Don&apos;t fake or edit results, tamper with the extension or Scrim&apos;s servers, or try to see scores
          that are hidden from you.
        </li>
        <li>Crew owners can void entries and remove members, and removed members cannot rejoin.</li>
      </ul>

      <h3>Names and other things you write</h3>
      <p>
        Display names, crew names and game suggestions must not be abusive, hateful, sexually explicit or illegal,
        and must not impersonate someone else. You own what you write.
      </p>

      <h3>The games</h3>
      <p>
        Scrim is an independent fan project. It is not affiliated with or endorsed by any of the games it supports. Game names belong to their owners. You play each game on its own site, under that
        site&apos;s terms. If a game changes, automatic capture may stop working until Scrim catches up.
      </p>

      <h3>No guarantees</h3>
      <p>
        Scrim is provided as it is, without warranties of any kind. It may change, go offline, lose data, or shut
        down at any time. To the extent allowable by law, Scrim&apos;s maintainers are not liable for any loss or
        damage from using it, or from not being able to.
      </p>

      <h3>Ending things</h3>
      <p>
        You can stop using Scrim at any time and ask for your data to be deleted (see above). Accounts, crews or names
        that break these terms may be removed.
      </p>

      <h3>Changes and contact</h3>
      <p>
        These terms may be updated. Continuing to use Scrim after a change means you
        accept it. Questions? Open an issue on{" "}
        <a href={ISSUES} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>

      <div className="back-home">
        <Link href="/" className="btn btn-primary">
          ← Back to Scrim
        </Link>
      </div>
    </article>
  );
}
