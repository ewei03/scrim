"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { EXTENSION_STORE_URL, type ExtensionState } from "@/lib/extension";
import { ExternalArrow } from "./ExternalArrow";

const seenKey = (userId: string) => `scrim-welcome-seen:${userId}`;

function seen(userId: string): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) !== null;
  } catch {
    return false;
  }
}

function markSeen(userId: string) {
  try {
    localStorage.setItem(seenKey(userId), "1");
  } catch {
    // Storage blocked: it could show once more within the first few minutes.
  }
}

/** How long after an account is created it still counts as "just signed up". */
const NEW_ACCOUNT_MS = 10 * 60_000;

/**
 * Getting-started guide for guests, shown once: the first time a brand-new
 * guest reaches the home page, right after signing in. It's marked as seen the
 * moment it opens, so it never comes back, whether it's closed, the player
 * navigates away, or they return to the home page later. Older accounts never
 * see it, even on a new browser, and Google accounts don't either. Each step
 * ticks off as it's done.
 */
export function Welcome({
  userId,
  accountCreatedAt,
  extension,
  hasCrew,
}: {
  userId: string;
  /** The auth account's creation time (ISO). */
  accountCreatedAt: string;
  extension: ExtensionState;
  hasCrew: boolean;
}) {
  const connected = extension === "connected";
  // Decided once, on first render.
  const [show, setShow] = useState(
    () => Date.now() - Date.parse(accountCreatedAt) < NEW_ACCOUNT_MS && !seen(userId),
  );

  useEffect(() => {
    if (show) markSeen(userId);
  }, [show, userId]);

  const open = show;

  function close() {
    setShow(false);
  }

  const steps = [
    {
      done: connected,
      key: true,
      title: "Install the Scrim extension",
      body: connected ? (
        <>Installed and connected. Your scores will be submitted for you.</>
      ) : (
        <>
          This is super important! Without it you won't get the full Scrim experience. The extension automatically submits your scores to Scrim.
          <a className="btn btn-primary welcome-cta" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
            Add to Chrome <ExternalArrow />
          </a>
        </>
      ),
    },
    {
      done: hasCrew,
      key: false,
      title: "Join a crew",
      body: <>Ask a friend for their crew&apos;s invite link and open it to join.</>,
    },
    {
      done: false,
      key: false,
      title: "Play!",
      body: <>At midnight, the winner is crowned. Good luck!</>,
    },
  ];

  return (
    <Modal open={open} onClose={close} title="Welcome to Scrim!">
      <p>Follow the steps below to get started:</p>
      <ol className="welcome-steps">
        {steps.map((s) => (
          <li
            key={s.title}
            className={[s.done && "done", s.key && !s.done && "welcome-key"].filter(Boolean).join(" ") || undefined}
          >
            <strong>
              {s.title}
              {s.done && <span className="sr-only"> (done)</span>}
            </strong>
            <span className="muted small">{s.body}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-primary" onClick={close}>
        Got it
      </button>
      <p className="muted small">You can find all of this again under the ? button.</p>
    </Modal>
  );
}
