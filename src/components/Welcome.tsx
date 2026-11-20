"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import type { ExtensionState } from "@/lib/extension";

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
 * Getting-started guide, shown once: the first time a brand-new account reaches
 * the home page, right after signing up. It's marked as seen the moment it
 * opens, so it never comes back, whether it's closed, the player navigates
 * away, or they return to the home page later. Older accounts never see it,
 * even on a new browser. Each step ticks off as it's done.
 */
export function Welcome({
  userId,
  accountCreatedAt,
  extension,
  hasCrew,
  hasGames,
}: {
  userId: string;
  /** The auth account's creation time (ISO). */
  accountCreatedAt: string;
  extension: ExtensionState;
  hasCrew: boolean;
  hasGames: boolean;
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
      done: hasCrew,
      title: "Create a crew",
      body: (
        <>
          Invite your friends to your crew!
        </>
      ),
    },
    {
      done: hasGames,
      title: "Pick your games",
      body: (
        <>
          Choose your favourite games to play. You can edit the list at any time.
        </>
      ),
    },
    {
      done: connected,
      title: "Get the Scrim extension",
      body: (
        <>
          The extension tracks your scores so you don&apos;t have to submit anything manually. <strong>HIGHLY RECOMMENDED!</strong>
        </>
      ),
    },
    {
      done: false,
      title: "Play!",
      body: (
        <>
          At midnight, the winner is crowned. Good luck!
        </>
      ),
    },
  ];

  return (
    <Modal open={open} onClose={close} title="Welcome to Scrim!">
      <p>Follow the steps below to get started:</p>
      <ol className="welcome-steps">
        {steps.map((s) => (
          <li key={s.title} className={s.done ? "done" : undefined}>
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
