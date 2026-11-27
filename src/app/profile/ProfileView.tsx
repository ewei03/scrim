"use client";

import { confirmDialog } from "@/components/ConfirmDialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExtensionPanel } from "@/components/ExtensionPanel";
import { GoogleButton } from "@/components/GoogleButton";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";
import { askExtension } from "@/lib/extension";
import { cleanName, MAX_DISPLAY_NAME, typedName } from "@/lib/names";
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
      .update({ display_name: cleanName(name, MAX_DISPLAY_NAME) })
      .eq("id", user!.id);
    if (error) return setError(errorMessage(error));
    await refreshProfile();
    setSaved(true);
  }

  async function signOut() {
    if (isGuest && !(await confirmDialog("Guest accounts can't be recovered after signing out. Sign out anyway?")))
      return;
    // Disconnect the extension, so whoever signs in next starts fresh and none
    // of their games land on this account.
    await askExtension("unpair");
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
              maxLength={MAX_DISPLAY_NAME}
              value={name}
              onChange={(e) => {
                setName(typedName(e.target.value));
                setSaved(false);
              }}
              required
            />
            <button className="btn btn-primary" disabled={!cleanName(name, MAX_DISPLAY_NAME) || cleanName(name, MAX_DISPLAY_NAME) === profile?.display_name}>
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
              You&apos;re playing as a <strong>guest</strong>. Link your Google account to keep your stats.
            </p>
            <p className="muted small">
              As a guest, you will be removed from your crews after 48 hours of inactivity.
            </p>
            <GoogleButton mode="link" onError={setError} />
          </>
        ) : (
          <p>Signed in as {user?.email ?? "a Google account"}.</p>
        )}
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </section>
      {error && <p className="error">{error}</p>}

      <div className="back-home">
        <Link href="/" className="btn btn-primary">
          ← Back to Scrim
        </Link>
      </div>
    </div>
  );
}
