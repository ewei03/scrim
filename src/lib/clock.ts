"use client";

import { useSyncExternalStore } from "react";

/**
 * How you like times shown: 12-hour ("9:42 PM", the default) or 24-hour
 * ("21:42"). Yours alone, kept in this browser, and the same everywhere:
 * every scoreboard in every crew. Clicking a scoreboard's Time heading flips
 * it, and every board on the page (and in other tabs) follows.
 */
const KEY = "scrim-clock";
const EVENT = "scrim-clock-change";

// Used when storage is blocked, so the switch still works until a reload.
let fallback = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "24";
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** True for a 24-hour clock. */
export function useClock24h(): boolean {
  // On the server (and the first render), the default.
  return useSyncExternalStore(subscribe, read, () => false);
}

export function toggleClock() {
  const next = read() ? "12" : "24";
  fallback = next === "24";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: the fallback above carries it until a reload.
  }
  window.dispatchEvent(new Event(EVENT));
}
