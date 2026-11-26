"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "./Modal";

/**
 * The site's own confirm(), in place of the browser's: same message, same OK
 * and Cancel, in a Scrim-styled modal. Resolves true for OK; Cancel, Escape
 * and × resolve false.
 *
 *   if (!(await confirmDialog("Delete it?"))) return;
 *
 * One <ConfirmDialogHost /> in the layout shows them.
 */
export async function confirmDialog(message: string): Promise<boolean> {
  return (await ask(message)) !== null;
}

/**
 * confirmDialog with a checkbox under the message (unticked to start).
 * Resolves whether it was ticked, or null if cancelled.
 *
 *   const wipe = await confirmWithOption("Remove them?", "Also delete their stats");
 *   if (wipe === null) return;
 */
export function confirmWithOption(message: string, option: string): Promise<boolean | null> {
  return ask(message, { option });
}

/**
 * For the riskiest actions: OK stays disabled until this text (say, the
 * crew's name) is typed in. Case and surrounding spaces don't matter.
 *
 *   if (!(await confirmByTyping("Delete Sam's Crew?", "Sam's Crew"))) return;
 */
export async function confirmByTyping(message: string, text: string): Promise<boolean> {
  return (await ask(message, { typed: text })) !== null;
}

function ask(message: string, extra: { option?: string; typed?: string } = {}): Promise<boolean | null> {
  return new Promise((resolve) => {
    // A new one replaces any still open (that one counts as cancelled).
    current?.resolve(null);
    current = { message, ...extra, resolve };
    emit();
  });
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Pending = { message: string; option?: string; typed?: string; resolve: (checked: boolean | null) => void };
let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function answer(checked: boolean | null) {
  const pending = current;
  current = null;
  emit();
  pending?.resolve(checked);
}

export function ConfirmDialogHost() {
  const pending = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const ok = useRef<HTMLButtonElement>(null);
  const typeIn = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  // Each new question starts unticked and empty.
  const [asked, setAsked] = useState(pending);
  if (asked !== pending) {
    setAsked(pending);
    setChecked(false);
    setTyped("");
  }
  const needsTyping = pending?.typed !== undefined;
  const canConfirm = !needsTyping || sameText(typed, pending?.typed ?? "");

  // Like the browser's, OK has focus, so Enter confirms. When something has
  // to be typed in first, the box has focus instead.
  useEffect(() => {
    if (pending) (pending.typed !== undefined ? typeIn.current : ok.current)?.focus();
  }, [pending]);

  return (
    <Modal open={pending !== null} onClose={() => answer(null)} title="Are you sure?">
      <p className="confirm-message">{pending?.message}</p>
      <form
        className="stack confirm-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) answer(checked);
        }}
      >
        {needsTyping && (
          <label className="field confirm-typed">
            <span>
              Type <strong>{pending?.typed}</strong> to confirm
            </span>
            <input
              className="input"
              ref={typeIn}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="row confirm-actions">
          {/* The checkbox shares the buttons' row, at the left, so it adds no height. */}
          {pending?.option && (
            <label className="check confirm-option">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{" "}
              {pending.option}
            </label>
          )}
          <button type="button" className="btn" onClick={() => answer(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" ref={ok} disabled={!canConfirm}>
            OK
          </button>
        </div>
      </form>
    </Modal>
  );
}
