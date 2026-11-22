"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A native <dialog> modal: Escape, the × button and (unless `dismissOnBackdrop`
 * is false) a backdrop click all close it.
 */
export function Modal({
  open,
  onClose,
  title,
  size = "small",
  dismissOnBackdrop = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "small" | "large";
  /** False for forms, so a stray click outside doesn't lose what was typed. */
  dismissOnBackdrop?: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // A click outside the dialog's box closes it. Judged by where the pointer
  // went down and came up, not by the event's target, so it works wherever
  // the backdrop is clicked; and a drag that starts inside (selecting text)
  // and ends outside doesn't count. Keyboard "clicks" have no pointerdown.
  useEffect(() => {
    const d = dialog.current;
    if (!d || !dismissOnBackdrop) return;
    const outside = (e: MouseEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let downOutside = false;
    const down = (e: PointerEvent) => {
      downOutside = outside(e);
    };
    const click = (e: MouseEvent) => {
      if (downOutside && outside(e)) closeRef.current();
      downOutside = false;
    };
    d.addEventListener("pointerdown", down);
    d.addEventListener("click", click);
    return () => {
      d.removeEventListener("pointerdown", down);
      d.removeEventListener("click", click);
    };
  }, [dismissOnBackdrop]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    // With Cache Components, a page we navigate away from is hidden (React
    // <Activity>), not unmounted, so an open modal would stay in the top layer
    // and make the new page unclickable. Effects clean up on hide: close it.
    return () => {
      if (d.open) d.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`dialog ${size === "small" ? "dialog-sm" : ""}`}
      aria-labelledby={titleId}
      // Fires on Escape and on close(); keeps the parent's state in sync. The
      // event comes a moment after close(), so if the dialog is open again by
      // then (an effect closed and reopened it, as React's Strict Mode does
      // in development), it's stale: ignore it.
      onClose={() => {
        if (!dialog.current?.open) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="dialog-body stack">{children}</div>
    </dialog>
  );
}
