"use client";

import { useEffect, useRef } from "react";

/** Spin speeds are in degrees per second. */
const CRUISE = 45; // its steady speed when left alone
const FRICTION = 1.2; // per second: how fast a click's spin dies back down to cruising
const MAX_SPEED = 4000;
const CLICK_KICK = 900;

const PATH =
  "M20 20 H51 a11 11 0 1 1 18 0 H100 V51 a11 11 0 1 1 0 18 V100 H69 a11 11 0 1 0 -18 0 H20 V69 a11 11 0 1 0 0 -18 Z";

function Piece() {
  return (
    <span className="piece-float">
      <svg viewBox="2 2 116 116" aria-hidden>
        <path d={PATH} />
      </svg>
    </span>
  );
}

/**
 * The landing page's puzzle piece. It turns slowly clockwise all the time;
 * clicking it spins it faster for a moment, clockwise or anticlockwise at
 * random. Reduced motion keeps it still
 * until clicked. Below it is a faded reflection, flipped top to bottom, so it
 * turns and drifts the opposite way. Its size comes from the box it's put in
 * (see .landing-piece).
 */
export function SpinningPiece() {
  const button = useRef<HTMLButtonElement>(null);
  const state = useRef({ angle: 0, speed: 0 });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();

    function tick(now: number) {
      // Long gaps (a hidden tab) shouldn't fling it.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = state.current;

      const cruise = reduce.matches ? 0 : CRUISE;
      // A click's extra speed eases back down to cruising.
      s.speed = cruise + (s.speed - cruise) * Math.exp(-FRICTION * dt);
      s.angle = (s.angle + s.speed * dt) % 360;

      // Both the piece and its reflection turn by this.
      button.current?.style.setProperty("--angle", `${s.angle}deg`);
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function spin() {
    const s = state.current;
    // Each click picks a way at random; either way it builds on the current
    // speed, then eases back to the slow clockwise turn.
    const dir = Math.random() < 0.5 ? -1 : 1;
    s.speed = dir * Math.min(Math.abs(s.speed) + CLICK_KICK, MAX_SPEED);
  }

  return (
    <button ref={button} type="button" className="hero-piece" onClick={spin} aria-label="Spin the puzzle piece">
      <Piece />
      <span className="piece-reflection">
        <Piece />
      </span>
    </button>
  );
}
