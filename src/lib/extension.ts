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
 * Connects the extension as soon as someone's signed in and it's installed
 * but not connected: after signing in, or when it's installed with Scrim open
 * (it marks the page then). There's no Disconnect: signing out disconnects
 * it, and removing the extension does the rest. Not when it's connected to
 * another account in this browser: switching stays up to the player. Mounted
 * once, in the layout.
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
        if (!cancelled && status?.ok && !status.connected) await pairExtension(userId!, name);
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

export function useExtension() {
  const { user } = useAuth();
  const [state, setState] = useState<ExtensionState>("checking");
  const userId = user?.id;

  const refresh = useCallback(async () => {
    const reply = await askExtension<StatusReply>("status");
    if (!reply) setState("missing");
    else if (!reply.connected) setState("disconnected");
    else if (reply.userId && reply.userId !== userId) setState("other-account");
    else setState("connected");
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    // The bridge marks <html> at document_start, but give it a beat on first load.
    const timer = setTimeout(() => {
      askExtension<StatusReply>("status").then((reply) => {
        if (cancelled) return;
        if (!reply) setState("missing");
        else if (!reply.connected) setState("disconnected");
        else if (reply.userId && reply.userId !== userId) setState("other-account");
        else setState("connected");
      });
    }, 50);
    // Connected or disconnected elsewhere on the page, or just installed.
    window.addEventListener(CHANGED, refresh);
    const seen = new MutationObserver(() => refresh());
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scrim-extension"] });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(CHANGED, refresh);
      seen.disconnect();
    };
  }, [userId, refresh]);

  return { state, refresh };
}
