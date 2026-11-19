"use client";

import Link from "next/link";
import { useRef } from "react";

export function HelpButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        className="icon-btn"
        onClick={() => dialog.current?.showModal()}
        title="How Scrim works"
        aria-label="How Scrim works"
      >
        ?
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="help-title"
        // Click on the backdrop closes it.
        onClick={(e) => e.target === dialog.current && close()}
      >
        <div className="dialog-head">
          <h2 id="help-title">How Scrim works</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog-body stack">
          <p>
            Scrim turns daily puzzles into a friendly competition. Everyone plays the same puzzle on their own time,
            and Scrim keeps score.
          </p>

          <h3>The basics</h3>
          <ol>
            <li>
              <strong>Make a crew.</strong> A crew is your friend group. It keeps rankings, head-to-head records and
              an archive of past lobbies.
            </li>
            <li>
              <strong>Start a lobby</strong> for today&apos;s puzzle. Pick when it closes and whether scores stay
              hidden until you submit.
            </li>
            <li>
              <strong>Share the invite link.</strong> Opening a crew or lobby link joins that crew.
            </li>
            <li>
              <strong>Play</strong> on the game&apos;s own site, whenever suits you before the lobby closes.
            </li>
            <li>
              <strong>Your score lands in the lobby.</strong> When the lobby closes, Scrim declares the winner.
            </li>
          </ol>

          <h3>Getting your score in</h3>
          <ul>
            <li>
              <strong>Automatic (recommended):</strong> install the Scrim Chrome extension and connect it on your{" "}
              <Link href="/me" onClick={close}>
                profile
              </Link>
              . Finish a game and your result goes into every open lobby for that puzzle. It shows
              up with a ⚡.
            </li>
            <li>
              <strong>Paste:</strong> click Share in the game and paste the text into the lobby (⎘).
            </li>
            <li>
              <strong>Manual:</strong> enter your score yourself, if the host allows it (✎).
            </li>
          </ul>
          <p className="muted small">You get one submission per lobby. The host can void an entry if something went wrong.</p>

          <h3>Winning</h3>
          <ul>
            <li>Fewest guesses wins. A miss (X/6) can&apos;t win.</li>
            <li>Ties share the win: if two people get it in one, both get a win.</li>
            <li>A lobby closes at its deadline, or earlier if the host closes it.</li>
          </ul>

          <h3>No spoilers</h3>
          <p>
            With &quot;hide scores until you submit&quot; on, you see who has played but not how they did until
            you&apos;ve locked in your own result.
          </p>

          <h3>Rankings</h3>
          <p>
            Each crew tracks wins (W), games played (GP), win rate, average guesses, current win streak, your last
            five results, and head-to-head records between every pair of players.
          </p>

          <h3>Accounts</h3>
          <p>
            Play as a guest with just a name, or sign in with Google. Guest accounts live in one browser. Link Google
            from your profile to keep your stats if you switch computers.
          </p>

          <h3>Which puzzles?</h3>
          <p>
            Wordle for now, and only today&apos;s puzzle. More free daily games are on the way. Scrim only supports
            games anyone can play for free.
          </p>
        </div>
      </dialog>
    </>
  );
}
