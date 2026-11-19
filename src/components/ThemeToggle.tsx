"use client";

import { useSyncExternalStore } from "react";

const KEY = "scrim-theme";
const EVENT = "scrim-theme-change";

/** Runs in <head> before first paint so a saved theme never flashes. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

type Theme = "light" | "dark";

function effectiveTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function ThemeToggle() {
  // null on the server; the real value after hydration.
  const theme = useSyncExternalStore<Theme | null>(subscribe, effectiveTheme, () => null);

  function toggle() {
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked; the choice just won't persist.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className="icon-btn" onClick={toggle} title={label} aria-label={label}>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
