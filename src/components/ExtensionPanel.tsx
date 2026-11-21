"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { askExtension, useExtension } from "@/lib/extension";
import { errorMessage, rpc, supabaseConfig } from "@/lib/supabase";

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
      const token = await rpc<string>("create_extension_token");
      const reply = await askExtension<{ ok: boolean; error?: string; submitted?: number }>("pair", {
        token,
        ...supabaseConfig(),
        userId: user?.id,
        displayName: profile?.display_name,
      });
      if (!reply?.ok) throw new Error(reply?.error ?? "The extension didn't respond. Reload the page and try again.");
      if (reply.submitted) setNote(`Submitted ${reply.submitted} saved result${reply.submitted === 1 ? "" : "s"}.`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await rpc("revoke_extension_tokens");
      await askExtension("unpair");
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
            Install the Scrim extension and your results go straight into your crews when you finish a game.
          </p>
          <ol className="small muted">
            <li>
              Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and choose the <code>extension</code> folder in the Scrim project.
            </li>
            <li>Reload this page.</li>
          </ol>
        </>
      )}

      {(state === "disconnected" || state === "other-account") && (
        <>
          <p>
            {state === "other-account"
              ? "The extension is connected to a different Scrim account in this browser."
              : "The extension is installed. Connect it to your account to turn on automatic scores."}
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={connect}>
            {busy ? "Connecting…" : state === "other-account" ? "Connect to this account" : "Connect extension"}
          </button>
        </>
      )}

      {state === "connected" && (
        <>
          <p>
            <strong>⚡ Extension connected successfully.</strong> Your scores will now submit to your crews automatically.
          </p>
          <button className="btn" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        </>
      )}

      {note && <p className="muted small">{note}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
