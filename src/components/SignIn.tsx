"use client";

import { useState } from "react";
import { errorMessage, supabase } from "@/lib/supabase";

export function SignIn({ title = "Pick a name to play" }: { title?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().auth.signInAnonymously({
        options: { data: { display_name: name.trim() } },
      });
      if (error) setError(errorMessage(error));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      const { error } = await supabase().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (error) setError(errorMessage(error));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card stack">
      <h2>{title}</h2>
      <form className="row" onSubmit={guest}>
        <input
          className="input grow"
          placeholder="Your name"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Play as guest
        </button>
      </form>
      <div className="divider">or</div>
      <button className="btn" onClick={google}>
        Continue with Google
      </button>
      <p className="muted small">
        Guests can link a Google account later to keep their stats across devices.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
