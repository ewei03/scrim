"use client";

import { useRef, useState } from "react";
import type { GameAdapter } from "@/games/types";
import { gameStyle } from "./GameTag";
import { Modal } from "./Modal";

/**
 * Rearranging today's games: a small list in a modal. Pick a game up, drag
 * it, and it drops into the slot it's over (keyboard: focus it, arrow keys).
 * Saved with OK, along with whether games you've still to play go on top
 * (the list here is always your own order: those move up on the page, and
 * back into place once you've played them). Cancel, Escape, × and a click
 * outside leave both as they were.
 *
 * Always rendered, like the site's other modals: mounting a <dialog> already
 * open and closing it on unmount (as React's dev double-mount does) fires a
 * close event that shut it straight away. The list inside mounts on each
 * opening, so it starts from the current order.
 */
export function ReorderGames({
  open,
  games,
  unplayedFirst,
  onSave,
  onClose,
}: {
  open: boolean;
  /** In your order. */
  games: GameAdapter<unknown>[];
  /** Whether games you've still to play show first. */
  unplayedFirst: boolean;
  onSave: (ids: string[], unplayedFirst: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Reorder games">
      {open && <ReorderList games={games} unplayedFirst={unplayedFirst} onSave={onSave} onClose={onClose} />}
    </Modal>
  );
}

type Drag = {
  id: string;
  pointer: number;
  /** Where the pointer went down. */
  startY: number;
  /** How far it's moved since. */
  dy: number;
  from: number;
  /** The slot it would drop into. */
  to: number;
  /** The rows' boxes when it was picked up, in order. */
  boxes: { top: number; height: number }[];
  /** One row's height plus the gap: how far the others slide to make room. */
  step: number;
};

function ReorderList({
  games,
  unplayedFirst,
  onSave,
  onClose,
}: {
  games: GameAdapter<unknown>[];
  unplayedFirst: boolean;
  onSave: (ids: string[], unplayedFirst: boolean) => void;
  onClose: () => void;
}) {
  const [order, setOrder] = useState(() => games.map((g) => g.id));
  const [toPlayFirst, setToPlayFirst] = useState(unplayedFirst);
  const [drag, setDrag] = useState<Drag | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const byId = new Map(games.map((g) => [g.id, g]));

  function moveTo(from: number, to: number) {
    if (from === to) return;
    setOrder((ids) => {
      const next = [...ids];
      const [id] = next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  }

  // Pick up: the row lifts and follows the pointer (captured, so it keeps
  // following outside the row); the others slide aside to show where it'll go.
  function pickUp(e: React.PointerEvent<HTMLLIElement>, id: string) {
    if (e.button !== 0 || !list.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const boxes = [...list.current.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    const from = order.indexOf(id);
    const next = boxes[from + 1] ?? boxes[from - 1];
    const step = next ? Math.abs(next.top - boxes[from].top) : boxes[from].height;
    setDrag({ id, pointer: e.pointerId, startY: e.clientY, dy: 0, from, to: from, boxes, step });
  }

  function follow(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const { boxes, from } = drag;
    // Kept within the list, so it can't be dragged off into the dialog.
    const min = boxes[0].top - boxes[from].top;
    const max = boxes[boxes.length - 1].top - boxes[from].top;
    const dy = Math.min(max, Math.max(min, e.clientY - drag.startY));
    // The slot: the rows are all one height, so it's how many rows it's moved,
    // rounded (past halfway over a neighbour, it takes that neighbour's place).
    const to = Math.min(boxes.length - 1, Math.max(0, from + Math.round(dy / drag.step)));
    setDrag({ ...drag, dy, to });
  }

  // Put down: it locks into the slot it was over.
  function putDown(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    moveTo(drag.from, drag.to);
    setDrag(null);
  }

  /** How far each row is shifted while one is being dragged. */
  function offset(i: number): number {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.step;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.step;
    return 0;
  }

  return (
    <>
      <p className="muted small">This order is only visible to you.</p>
      <label className="check">
        <input type="checkbox" checked={toPlayFirst} onChange={(e) => setToPlayFirst(e.target.checked)} /> Show unplayed games first (preserves your ordering still)
      </label>
      <ol className={`reorder-list ${drag ? "sorting" : ""}`} ref={list}>
        {order.map((id, i) => {
          const game = byId.get(id);
          if (!game) return null;
          const lifted = drag?.id === id;
          return (
            <li
              key={id}
              className={`reorder-row ${lifted ? "lifted" : ""}`}
              style={{ ...gameStyle(game), transform: `translateY(${offset(i)}px)` }}
              tabIndex={0}
              aria-label={`${game.name}, ${i + 1} of ${order.length}. Drag or use the arrow keys to move it.`}
              onPointerDown={(e) => pickUp(e, id)}
              onPointerMove={follow}
              onPointerUp={putDown}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                if (to < 0 || to >= order.length) return;
                e.preventDefault();
                moveTo(i, to);
                // Keep focus on the row as it moves.
                requestAnimationFrame(() => (list.current?.children[to] as HTMLElement | undefined)?.focus());
              }}
            >
              <span className="reorder-grip" aria-hidden>
                ⠿
              </span>
              <span className="reorder-name">{game.name}</span>
            </li>
          );
        })}
      </ol>
      <div className="row confirm-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onSave(order, toPlayFirst);
            onClose();
          }}
        >
          OK
        </button>
      </div>
    </>
  );
}
