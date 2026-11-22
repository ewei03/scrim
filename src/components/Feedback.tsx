"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { errorMessage, rpc } from "@/lib/supabase";
import { Modal } from "./Modal";

export type FeedbackKind = "game" | "problem" | "other";

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "game", label: "Suggest a game" },
  { id: "problem", label: "Something's not working" },
  { id: "other", label: "Other" },
];

/** What helps look into a problem: the browser (e.g. Opera vs Chrome), the extension's version and the page. */
function problemDetails() {
  return {
    browser: navigator.userAgent,
    extension: document.documentElement.dataset.scrimExtension ?? null,
    page: location.pathname,
  };
}

/**
 * Feedback form: suggest a game, report a problem, or anything else. Messages
 * are private to the site owner. Suggesting a game needs a Google account;
 * guests can send the rest.
 */
export function Feedback({ initialKind = "game" }: { initialKind?: FeedbackKind }) {
  const { status, user, isGuest } = useAuth();
  // Google accounts come with an address Google has verified; guests don't.
  const accountEmail = !isGuest && user?.email ? user.email : "";
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const emailValue = email ?? accountEmail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (status !== "signedIn") {
    return <p className="muted small">Sign in to send feedback.</p>;
  }

  if (sent) {
    return (
      <div className="stack">
        <p>Thanks! Your message was sent.</p>
        <button type="button" className="btn" onClick={() => setSent(false)}>
          Send another
        </button>
      </div>
    );
  }

  const needsGoogle = kind === "game" && isGuest;
  const ready = kind === "game" ? Boolean(name.trim()) : Boolean(message.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rpc("send_feedback", {
        p_kind: kind,
        p_message: message || null,
        p_name: kind === "game" ? name : null,
        p_url: kind === "game" ? url || null : null,
        p_email: emailValue.trim() || null,
        p_details: kind === "problem" ? problemDetails() : null,
      });
      setName("");
      setUrl("");
      setMessage("");
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset className="field custom-fieldset">
        <legend>What&apos;s this about?</legend>
        <div className="choice-cards">
          {KINDS.map((k) => (
            <label key={k.id} className={`choice-card ${kind === k.id ? "chosen" : ""}`}>
              <input
                type="radio"
                name="feedback-kind"
                value={k.id}
                checked={kind === k.id}
                onChange={() => setKind(k.id)}
              />
              <strong>{k.label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      {needsGoogle ? (
        <p className="muted small">
          Suggesting a game needs a Google account. <Link href="/profile">Link one on your profile</Link> to send one.
        </p>
      ) : (
        <>
          {kind === "game" && (
            <>
              <label className="field">
                <span>Game</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  placeholder="e.g. Strands"
                />
              </label>
              <label className="field">
                <span>Link (optional)</span>
                <input
                  className="input"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  maxLength={300}
                  placeholder="https://…"
                />
              </label>
            </>
          )}
          <label className="field">
            <span>
              {kind === "game" ? "Anything else? (optional)" : kind === "problem" ? "What happened?" : "Message"}
            </span>
            <textarea
              className="input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={kind === "game" ? 3 : 5}
              required={kind !== "game"}
              placeholder={kind === "problem" ? "e.g. My Wordle score didn't show up in my crew" : undefined}
            />
          </label>
          <label className="field">
            <span>Email (optional)</span>
            <input
              className="input"
              type="email"
              value={emailValue}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <p className="muted small">
            {kind === "problem"
              ? "Your browser and extension version are sent along to help us look into it. Leave an email if you'd like a reply."
              : "Leave an email if you'd like a reply."}
          </p>
          <button className="btn btn-primary" disabled={busy || !ready}>
            {busy ? "Sending…" : kind === "game" ? "Send suggestion" : "Send"}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const OPEN_EVENT = "scrim-feedback";

/** Opens the feedback window from anywhere (it lives in the footer), on a given kind. */
export function openFeedback(kind: FeedbackKind = "game") {
  window.dispatchEvent(new CustomEvent<FeedbackKind>(OPEN_EVENT, { detail: kind }));
}

/** Inline text that opens the feedback window on "Suggest a game", e.g. "here!". */
export function SuggestGameButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" className="footer-link" onClick={() => openFeedback("game")}>
      {children}
    </button>
  );
}

/** Footer link that opens the feedback form in a small dialog. */
export function FeedbackLink() {
  // The kind it opened on; null while closed. Reopening starts a fresh form.
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [opens, setOpens] = useState(0);
  const open = (k: FeedbackKind) => {
    setKind(k);
    setOpens((n) => n + 1);
  };
  useEffect(() => {
    const show = (e: Event) => open((e as CustomEvent<FeedbackKind>).detail ?? "game");
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return (
    <>
      <button type="button" className="footer-link" onClick={() => open("problem")}>
        Feedback
      </button>
      <Modal open={kind !== null} onClose={() => setKind(null)} title="Feedback">
        <p>Suggest a game, report a problem, or just say hi!</p>
        {kind && <Feedback key={opens} initialKind={kind} />}
      </Modal>
    </>
  );
}
