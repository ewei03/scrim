import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy — Scrim" };

export default function PrivacyPage() {
  return (
    <article className="stack prose">
      <h1>Privacy</h1>
      <p className="muted small">Last updated November 19, 2026</p>
      <p>
        Scrim is a small hobby project for playing daily puzzles with friends. It collects only what it needs to run
        lobbies and keep score.
      </p>

      <h2>What Scrim stores</h2>
      <ul>
        <li>
          <strong>Your account:</strong> a display name. If you sign in with Google, your Google account&apos;s email
          address and name, as provided by Google sign-in.
        </li>
        <li>
          <strong>Your crews and lobbies:</strong> which crews you belong to, the lobbies you create, and their
          settings.
        </li>
        <li>
          <strong>Your results:</strong> your score for each lobby, the coloured grid, the share text if you pasted it
          or the extension submitted it, whether it was entered automatically, pasted or typed in, and when.
        </li>
        <li>
          <strong>Extension connection:</strong> if you connect the Chrome extension, a hashed copy of its access key
          and when it was last used.
        </li>
      </ul>
      <p>
        Scrim never sees your guessed words. Results only contain your score, the colour pattern and the puzzle
        number.
      </p>

      <h2>Who can see it</h2>
      <p>
        Your display name and results are visible to the other members of your crews. While a lobby is open and
        &quot;hide scores until you submit&quot; is on, other players can&apos;t see your result until they&apos;ve
        submitted their own.
      </p>

      <h2>The Chrome extension</h2>
      <ul>
        <li>
          It only runs on the Wordle page on nytimes.com and on the Scrim website. It doesn&apos;t read any other site
          or your browsing history.
        </li>
        <li>
          On the Wordle page it reads the game state that Wordle saves in your browser, and the coloured tiles on the
          board, once a game is finished. From that it sends Scrim your score, the colour grid and the puzzle number.
        </li>
        <li>
          It keeps your recent results and its connection details in the extension&apos;s own storage on your
          computer. Disconnecting it from your profile revokes its access key.
        </li>
      </ul>

      <h2>Where it&apos;s stored</h2>
      <p>
        Scrim&apos;s data is stored with Supabase, which also handles sign-in. Your browser keeps your login session
        and your light/dark mode preference in local storage. Guest accounts exist only in that browser session.
      </p>

      <h2>What Scrim doesn&apos;t do</h2>
      <ul>
        <li>No ads, no analytics or tracking scripts.</li>
        <li>Your data is never sold or shared with anyone outside your crews.</li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        To have your account and results deleted, open an issue on{" "}
        <a href="https://github.com/ewei03/scrim/issues" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
    </article>
  );
}
