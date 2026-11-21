"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "./Modal";
import { openSuggestGame } from "./SuggestGame";

const STEPS = [
  { title: "Create your crew", text: "Name your crew and pick your games. The more, the merrier!" },
  { title: "Invite your friends", text: "Share the link with your most competitive friends!" },
  { title: "Play!", text: "Your scores will save automatically. Go on, play your games!" },
  { title: "Win the day :)", text: "The rankings will finalize by midnight. Don't be late!" },
];

const SUBMIT = [
  {
    title: "Extension",
    badge: "Recommended",
    text: "Install the Scrim extension for your scores to auto-save.",
  },
  { title: "Paste", text: "Submit your score manually on the crew page." },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const tips: { icon: string; text: React.ReactNode }[] = [
    { icon: "🏆", text: "In the case of a tie, all players receive a win." },
    { icon: "🙈", text: "You can show/hide other players' scores in the crew settings." },
    { icon: "📊", text: "Rankings track wins, streaks and averages." },
    { icon: "🎲", text: "Create a custom game if your game doesn't exist in Scrim!" },
    {
      icon: "👤",
      text: (
        <>
          Playing as guest?{" "}
          <Link href="/profile" onClick={close}>
            Sign in
          </Link>{" "}
          to unlock the full experience!
        </>
      ),
    },
    {
      icon: "💡",
      text: (
        <>
          We&apos;re always open to adding new games. Suggest one{" "}
          <button
            type="button"
            className="footer-link"
            onClick={() => {
              close();
              openSuggestGame();
            }}
          >
            here!
          </button>
        </>
      ),
    },
  ];

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
        {/* Slides in each time it opens, like the pages do. */}
        <div className="stack page-enter help-body">
          <p className="help-lead">Follow these steps to activate Scrim - it&apos;s super quick and easy!</p>

          <section className="help-section">
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
          </section>

          <section className="help-section">
            <h3>Submitting your score (2 ways)</h3>
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
          </section>

          <section className="help-section">
            <h3>Tips</h3>
            <ul className="help-tips">
              {tips.map((t) => (
                <li key={t.icon}>
                  <span className="help-tip-icon" aria-hidden>
                    {t.icon}
                  </span>
                  {/* One wrapper, so links inside flow with the text instead of becoming separate columns. */}
                  <span>{t.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Modal>
    </>
  );
}
