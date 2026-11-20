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
            Turn daily puzzles into a friendly competition! Everyone plays the same puzzle on their own time,
            and Scrim keeps score for you.
          </p>

          <h3>The basics</h3>
          <ol>
            <li>
              <strong>Make a crew</strong> and pick the games it plays. Your crew is your friend group, or anyone you want to invite!
            </li>
            <li>
              <strong>Share the invite link.</strong> Opening it joins the crew.
            </li>
            <li>
              <strong>Play</strong> each day&apos;s puzzle on the game&apos;s own site. Good luck!
            </li>
            <li>
              <strong>Your score lands in the crew.</strong> At midnight in the crew&apos;s time zone, Scrim
              declares the day&apos;s winner.
            </li>
            <li>
              <strong>Don&apos;t wanna stay?</strong> Leave the crew from the crew page.
            </li>
          </ol>

          <h3>Getting your score in</h3>
          <ul>
            <li>
              Install the <strong>Scrim Chrome extension</strong> and connect it on your{" "}
              <Link href="/profile" onClick={close}>
                profile
              </Link>
              . Finish a game and your result goes into every crew that plays that game. *For NYT games, play while signed in to your NYT account: games played signed out
              don&apos;t count.
            </li>
            <li>
              Alternatively, you can manually enter your score by clicking Share in the game and paste the text into the crew page.
            </li>
          </ul>
          <p className="muted small">One submission per puzzle. The crew owner can void an entry if something went wrong.</p>

          <h3>Winning</h3>
          <ul>
            <li>
              The highest scoring player of the day earns a win on their Scrim ranking. Accumulate your wins and earn bragging rights!
            </li>
            <li>If a tie occurs, all players involved in the tie get a win.</li>
            <li>
              The day ends at midnight in the crew&apos;s time zone. Results
              after that don&apos;t count.
            </li>
          </ul>

          <h3>No spoilers</h3>
          <p>
            Enable &quot;hide scores until you submit&quot; to see who has played, but not how they did, until
            you&apos;ve locked in your own result.
          </p>

          <h3>Rankings</h3>
          <p>
            Each crew tracks wins, games played, win rate, an average for the game (guesses, mistakes or score) and
            current win streak.
          </p>

          <h3>Accounts</h3>
          <p>
            Play as a guest or sign in with Google. It&apos;s recommended to sign in with Google to keep your stats.
          </p>

          <h3>Which puzzles?</h3>
          <p>
            As of now, Scrim&apos;s games are integrated manually. Want another one? Use <strong>Suggest a game</strong> at the bottom of any page.
          </p>
        </div>
      </dialog>
    </>
  );
}
