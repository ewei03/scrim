"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { errorMessage, rpc } from "@/lib/supabase";
import { Modal } from "./Modal";

/** Form for suggesting a new game. Suggestions are private to the site owner. */
export function SuggestGame() {
  const { status, user, isGuest } = useAuth();
  // Google accounts come with an address Google has verified; guests don't.
  const accountEmail = !isGuest && user?.email ? user.email : "";
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const emailValue = email ?? accountEmail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (status !== "signedIn") {
    return <p className="muted small">Sign in with Google to suggest a game.</p>;
  }
  if (isGuest) {
    return (
      <p className="muted small">
        Suggestions need a Google account. <Link href="/profile">Link one on your profile</Link> to send one.
      </p>
    );
  }

  if (sent) {
    return (
      <div className="stack">
        <p>Thanks! Your suggestion was sent.</p>
        <button type="button" className="btn" onClick={() => setSent(false)}>
          Suggest another
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rpc("suggest_game", {
        p_name: name,
        p_url: url || null,
        p_notes: notes || null,
        p_email: emailValue.trim() || null,
      });
      setName("");
      setUrl("");
      setNotes("");
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
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
      <label className="field">
        <span>Anything else? (optional)</span>
        <textarea
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
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
        We&apos;ll contact you by email regarding any updates to your suggestion!
      </p>
      <button className="btn btn-primary" disabled={busy || !name.trim()}>
        {busy ? "Sending…" : "Send suggestion"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/** Footer link that opens the suggestion form in a small dialog. */
const OPEN_EVENT = "scrim-suggest-game";

/** Opens the Suggest a game window from anywhere (it lives in the footer). */
export function openSuggestGame() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Inline text that opens the Suggest a game window, e.g. "here!". */
export function SuggestGameButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" className="footer-link" onClick={openSuggestGame}>
      {children}
    </button>
  );
}

export function SuggestGameLink() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return (
    <>
      <button type="button" className="footer-link" onClick={() => setOpen(true)}>
        Suggest a game
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Suggest a game">
        <p>Want another daily puzzle on Scrim? Let us know!</p>
        <SuggestGame />
      </Modal>
    </>
  );
}
