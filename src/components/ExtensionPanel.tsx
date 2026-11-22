"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { EXTENSION_STORE_URL, pairExtension, useExtension } from "@/lib/extension";
import { errorMessage } from "@/lib/supabase";
import { ExternalArrow } from "./ExternalArrow";

export function ExtensionPanel() {
  const { user, profile } = useAuth();
  const { state, refresh } = useExtension();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const reply = await pairExtension(user!.id, profile?.display_name);
      if (reply.submitted) setNote(`Submitted ${reply.submitted} saved result${reply.submitted === 1 ? "" : "s"}.`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Chrome extension</h2>
      {state === "checking" && <p className="muted blink">Looking for the extension…</p>}

      {state === "missing" && (
        <>
          <p>
            <strong>Install</strong> and <strong>enable</strong> the Scrim extension and your results go straight into your crews when you finish a game. It&apos;s completely free!
          </p>
          <div className="extension-action">
            <a className="btn btn-primary" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
              Add to Chrome <ExternalArrow />
            </a>
          </div>
          <p className="muted small">Just enabled it? Refresh this page to verify.</p>
        </>
      )}

      {(state === "disconnected" || state === "other-account") && (
        <>
          <p>
            {state === "other-account"
              ? "The extension is connected to a different Scrim account in this browser."
              : "The extension isn't connected yet. Connect it to your account to turn on automatic scores."}
          </p>
          <button className="btn btn-primary extension-action" disabled={busy} onClick={connect}>
            {busy ? "Connecting…" : state === "other-account" ? "Connect to this account" : "Connect extension"}
          </button>
        </>
      )}

      {state === "connected" && (
        <>
          <p>
            <strong className="extension-ok">Extension connected successfully.</strong> Your scores will now submit to your crews automatically.
          </p>
        </>
      )}

      {state !== "checking" && (
        <p className="muted small">
          Note: ad blockers may prevent the extension from working properly.
        </p>
      )}

      {note && <p className="muted small">{note}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
