"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "./Modal";

/** "How Scrim works": short cards, a line each. */

const STEPS = [
  { title: "Make a crew", text: "Name it and pick your games." },
  { title: "Invite friends", text: "Share the link. Opening it joins." },
  { title: "Play", text: "Play each puzzle on its own site." },
  { title: "Win the day", text: "At midnight, the best score wins." },
];

const SUBMIT = [
  {
    title: "Extension",
    badge: "Recommended",
    text: "Finish a game and your score lands by itself. Play NYT games signed in.",
  },
  { title: "Paste", text: "Tap Share in the game, then paste it on the crew page." },
];

const TIPS = [
  { icon: "🏆", text: "Ties? Everyone tied gets the win." },
  { icon: "🙈", text: "No spoilers: hide scores until you submit." },
  { icon: "📊", text: "Rankings track wins, streaks and averages." },
  { icon: "🎲", text: "Custom games: track any daily game by hand." },
  { icon: "👤", text: "Guests stay a day. Sign in with Google to keep stats." },
  { icon: "💡", text: "Missing a game? Suggest one at the bottom of the page." },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        className="icon-btn icon-btn-raised"
        onClick={() => setOpen(true)}
        title="How Scrim works"
        aria-label="How Scrim works"
      >
        ?
      </button>
      <Modal open={open} onClose={close} title="How Scrim works" size="large">
        <p className="help-lead">Daily puzzles, played as a friendly competition.</p>

        <h3>How it works</h3>
        <ol className="help-grid">
          {STEPS.map((s, i) => (
            <li key={s.title} className="help-card">
              <p className="help-card-title">
                <span className="help-num">{i + 1}.</span>
                {s.title}
              </p>
              <p className="help-card-text">{s.text}</p>
            </li>
          ))}
        </ol>

        <h3>Getting your score in</h3>
        <ul className="help-grid">
          {SUBMIT.map((s, i) => (
            <li key={s.title} className="help-card">
              <p className="help-card-title">
                <span className="help-num">{i + 1}.</span>
                {s.title}
                {s.badge && <span className="help-badge">{s.badge}</span>}
              </p>
              <p className="help-card-text">{s.text}</p>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Set up the extension on your{" "}
          <Link href="/profile" onClick={close}>
            profile
          </Link>
          . One submission per puzzle.
        </p>

        <h3>Good to know</h3>
        <ul className="help-tips">
          {TIPS.map((t) => (
            <li key={t.text}>
              <span className="help-tip-icon" aria-hidden>
                {t.icon}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
