"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { rpc, supabaseConfig } from "./supabase";

/**
 * Talks to the Scrim Chrome extension through its content script
 * (extension/scrim-bridge.js) using window.postMessage.
 */

type Reply = { ok: boolean; error?: string; [key: string]: unknown };

/** The extension's Chrome Web Store page. */
export const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/scrim/ccemknbnedmlnmjjaidgjckjbhiphidg";

export function extensionInstalled(): boolean {
  return typeof document !== "undefined" && Boolean(document.documentElement.dataset.scrimExtension);
}

export function askExtension<T extends Reply = Reply>(
  type: "pair" | "unpair" | "status" | "sync",
  payload?: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<T | null> {
  if (!extensionInstalled()) return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "scrim-ext" || event.data.id !== id) return;
      done(event.data.reply as T);
    }
    function done(value: T | null) {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "scrim-web", id, type, payload }, window.location.origin);
  });
}

export type ExtensionState =
  | "checking"
  | "missing" // not installed
  | "disconnected" // installed, not paired
  | "other-account" // paired to a different Scrim user on this browser
  | "connected";

type StatusReply = Reply & { connected: boolean; userId: string | null; displayName: string | null };
type PairReply = Reply & { submitted?: number };

/** Fired on window when this page connects the extension, so every view refreshes. */
const CHANGED = "scrim-extension-changed";

/** Connects the extension to this account: a new token, handed to the extension. */
export async function pairExtension(userId: string, displayName: string | undefined): Promise<PairReply> {
  const token = await rpc<string>("create_extension_token");
  const reply = await askExtension<PairReply>("pair", { token, ...supabaseConfig(), userId, displayName });
  if (!reply?.ok) throw new Error(reply?.error ?? "The extension didn't respond. Reload the page and try again.");
  window.dispatchEvent(new Event(CHANGED));
  return reply;
}

/**
 * Keeps the extension connected to whoever is signed in to Scrim in this
 * browser: after signing in, when it's installed with Scrim open (it marks the
 * page then), and when it's still connected to someone else (another account
 * that didn't sign out cleanly, or a connection too old to say whose it is),
 * so one person's games never land on another's account. Signing out
 * disconnects it. Mounted once, in the layout.
 */
export function ExtensionAutoConnect() {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const name = profile?.display_name;

  useEffect(() => {
    if (!userId || name === undefined) return;
    let cancelled = false;
    let running = false;
    async function tryConnect() {
      if (cancelled || running || !extensionInstalled()) return;
      running = true;
      try {
        const status = await askExtension<StatusReply>("status");
        if (!cancelled && status?.ok && (!status.connected || status.userId !== userId)) {
          await pairExtension(userId!, name);
        }
      } catch {
        // The Connect button on the profile page is still there, with the error.
      } finally {
        running = false;
      }
    }
    // The bridge marks <html> at document_start; give it a beat on first load.
    const timer = setTimeout(tryConnect, 50);
    const seen = new MutationObserver(tryConnect);
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scrim-extension"] });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      seen.disconnect();
    };
  }, [userId, name]);

  return null;
}

/**
 * The extension's status. An error reply (e.g. the extension was just reloaded
 * and hasn't settled) isn't "disconnected": ask again a couple of times first.
 */
async function readStatus(): Promise<StatusReply | null> {
  let reply: StatusReply | null = null;
  for (let tries = 0; tries < 3; tries++) {
    reply = await askExtension<StatusReply>("status");
    if (!reply || reply.ok) return reply;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return reply;
}

function stateOf(reply: StatusReply | null, userId: string | undefined): ExtensionState {
  if (!reply) return "missing";
  if (!reply.connected) return "disconnected";
  if (reply.userId !== userId) return "other-account";
  return "connected";
}

export function useExtension() {
  const { user } = useAuth();
  const [state, setState] = useState<ExtensionState>("checking");
  const userId = user?.id;

  const refresh = useCallback(async () => {
    setState(stateOf(await readStatus(), userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    // The bridge marks <html> at document_start, but give it a beat on first load.
    const timer = setTimeout(() => {
      readStatus().then((reply) => {
        if (!cancelled) setState(stateOf(reply, userId));
      });
    }, 50);
    // Connected or disconnected elsewhere on the page, or just installed.
    window.addEventListener(CHANGED, refresh);
    const seen = new MutationObserver(() => refresh());
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scrim-extension"] });
    // Back from a game's tab: check again, so a passing hiccup doesn't stick.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(CHANGED, refresh);
      document.removeEventListener("visibilitychange", onVisible);
      seen.disconnect();
    };
  }, [userId, refresh]);

  return { state, refresh };
}
