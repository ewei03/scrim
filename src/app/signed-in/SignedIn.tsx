"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Where Google's redirect sign-in lands. It runs in the pop-up window the
 * sign-in button opened, so once the session is in, close it: the window you
 * started from has already signed in (Supabase shares sessions between them).
 * If the browser won't let it close (e.g. it was opened some other way), go
 * home instead.
 */
export function SignedIn() {
  const { status } = useAuth();
  const router = useRouter();
  const signedIn = status === "signedIn";

  useEffect(() => {
    if (!signedIn) return;
    window.close();
    const fallback = setTimeout(() => router.replace("/"), 400);
    return () => clearTimeout(fallback);
  }, [signedIn, router]);

  return (
    <div className="stack">
      <h1>{signedIn ? "You're signed in" : "Signing you in…"}</h1>
      <p className="muted">
        {signedIn ? (
          <>
            You can close this window and go back to Scrim. <Link href="/">Or continue here →</Link>
          </>
        ) : status === "error" || status === "signedOut" ? (
          <>
            Sign-in didn&apos;t finish. <Link href="/">Back to Scrim</Link>
          </>
        ) : (
          "One moment."
        )}
      </p>
    </div>
  );
}
