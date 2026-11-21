"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
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
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    // A new one replaces any still open (that one counts as cancelled).
    current?.resolve(false);
    current = { message, resolve };
    emit();
  });
}

type Pending = { message: string; resolve: (ok: boolean) => void };
let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function answer(ok: boolean) {
  const pending = current;
  current = null;
  emit();
  pending?.resolve(ok);
}

export function ConfirmDialogHost() {
  const pending = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const ok = useRef<HTMLButtonElement>(null);

  // Like the browser's, OK has focus, so Enter confirms.
  useEffect(() => {
    if (pending) ok.current?.focus();
  }, [pending]);

  return (
    <Modal open={pending !== null} onClose={() => answer(false)} title="Are you sure?">
      <p className="confirm-message">{pending?.message}</p>
      <div className="row confirm-actions">
        <button type="button" className="btn" onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" ref={ok} onClick={() => answer(true)}>
          OK
        </button>
      </div>
    </Modal>
  );
}
