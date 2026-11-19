"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";

/**
 * Talks to the Scrim Chrome extension through its content script
 * (extension/scrim-bridge.js) using window.postMessage.
 */

type Reply = { ok: boolean; error?: string; [key: string]: unknown };

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
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

  return { state, refresh };
}
