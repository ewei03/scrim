"use client";

import { useState } from "react";
import { GoogleButton } from "@/components/GoogleButton";
import { cleanName, MAX_DISPLAY_NAME, typedName } from "@/lib/names";
import { errorMessage, supabase } from "@/lib/supabase";

export function SignIn({ title = "Pick a name to get started" }: { title?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().auth.signInAnonymously({
        options: { data: { display_name: cleanName(name, MAX_DISPLAY_NAME) } },
      });
      if (error) setError(errorMessage(error));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h2>{title}</h2>
      <form className="row" onSubmit={guest}>
        <input
          className="input grow"
          placeholder="Your name"
          maxLength={MAX_DISPLAY_NAME}
          value={name}
          onChange={(e) => setName(typedName(e.target.value))}
          required
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !cleanName(name, MAX_DISPLAY_NAME)}>
          Sign in as guest
        </button>
      </form>
      <div className="divider">or</div>
      <GoogleButton mode="signin" onError={setError} />
      <p className="muted small">
        Signing in with Google is recommended to keep stats across devices.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
