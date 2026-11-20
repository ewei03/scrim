"use client";

import Link from "next/link";
import { useState } from "react";
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
    // Storage blocked: it shows again next visit, which is fine.
  }
}

/**
 * Getting-started guide, shown on the home page until it's dismissed, unless
 * the player is already set up. Each step ticks off as it's done.
 */
export function Welcome({
  userId,
  extension,
  hasCrew,
  hasGames,
  onCreateCrew,
}: {
  userId: string;
  extension: ExtensionState;
  hasCrew: boolean;
  hasGames: boolean;
  onCreateCrew: () => void;
}) {
  const connected = extension === "connected";
  const setUp = hasCrew && hasGames && connected;
  // Decided once, when the extension check is done, so set-up players never
  // see it and finishing a step doesn't close it under you.
  const [show, setShow] = useState<boolean | null>(null);
  if (show === null && extension !== "checking") setShow(!setUp && !seen(userId));
  const open = show === true;

  function close() {
    markSeen(userId);
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
    <Modal open={open} onClose={close} title="Welcome to Scrim">
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
