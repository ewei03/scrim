"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExtensionPanel } from "@/components/ExtensionPanel";
import { GoogleButton } from "@/components/GoogleButton";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";
import { askExtension } from "@/lib/extension";
import { errorMessage, supabase } from "@/lib/supabase";

export function ProfileView() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}

function Profile() {
  const { profile, user, isGuest, refreshProfile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase()
      .from("profiles")
      .update({ display_name: name.trim() })
      .eq("id", user!.id);
    if (error) return setError(errorMessage(error));
    await refreshProfile();
    setSaved(true);
  }

  async function signOut() {
    if (isGuest && !confirm("Guest accounts can't be recovered after signing out. Sign out anyway?")) return;
    // Stop the extension submitting results to this account from this browser.
    const status = await askExtension<{ ok: boolean; userId: string | null }>("status");
    if (status?.userId === user?.id) await askExtension("unpair");
    await supabase().auth.signOut();
    router.push("/");
  }

  return (
    <div className="stack-lg">
      <h1>Profile</h1>
      <form className="card stack" onSubmit={save}>
        <label className="field">
          <span>Display name</span>
          <div className="row">
            <input
              className="input grow"
              maxLength={24}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              required
            />
            <button className="btn btn-primary" disabled={!name.trim() || name.trim() === profile?.display_name}>
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </label>
      </form>

      <ExtensionPanel />

      <section className="card stack">
        <h2>Account</h2>
        {isGuest ? (
          <>
            <p>
              You&apos;re playing as a <strong>guest</strong>. Clearing site data or switching devices loses your data.
            </p>
            <GoogleButton mode="link" onError={setError} />
            <p className="muted small">Linking keeps your crews and stats and lets you sign in anywhere.</p>
          </>
        ) : (
          <p>Signed in as {user?.email ?? "a Google account"}.</p>
        )}
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </section>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
