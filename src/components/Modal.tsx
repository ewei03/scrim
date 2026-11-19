"use client";

import { useEffect, useId, useRef } from "react";

/** A native <dialog> modal: Escape, the × button and a backdrop click all close it. */
export function Modal({
  open,
  onClose,
  title,
  size = "small",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "small" | "large";
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`dialog ${size === "small" ? "dialog-sm" : ""}`}
      aria-labelledby={titleId}
      // Fires on Escape and on close(); keeps the parent's state in sync.
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
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
