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
      // Fires on Escape and on close(); keeps the parent's state in sync.
      onClose={onClose}
      onClick={(e) => dismissOnBackdrop && e.target === dialog.current && onClose()}
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
