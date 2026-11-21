"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, supabase } from "@/lib/supabase";

/**
 * "Continue with Google", done with Google's own sign-in on Scrim's page
 * (Google Identity Services), so Google's prompt names Scrim's address rather
 * than the Supabase project's. Google hands back an ID token, which Supabase
 * turns into a session (sign in) or a linked identity (guest → Google).
 *
 * Either way, Google's sign-in opens in a small pop-up window, not a tab.
 *
 * Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID (see README). Without it, falls back to
 * Supabase's redirect flow in a pop-up window (sign-in) or this tab (linking).
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

type GoogleId = {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    nonce: string;
    ux_mode: "popup";
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme: string; size: string; text: string; shape: string; width: number; logo_alignment: string },
  ): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let scriptLoad: Promise<GoogleId> | null = null;

function loadGoogle(): Promise<GoogleId> {
  scriptLoad ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn't load."));
    script.onerror = () => {
      scriptLoad = null; // allow a retry on the next render
      reject(new Error("Couldn't load Google sign-in. Check your connection or ad blocker."));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/** A random nonce, and its SHA-256 hex for Google (Supabase checks it against the raw one). */
async function makeNonce() {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

export function GoogleButton({
  mode,
  onError,
}: {
  /** Sign in (or up), or attach Google to the current guest account. */
  mode: "signin" | "link";
  onError: (message: string | null) => void;
}) {
  if (!CLIENT_ID) return <RedirectButton mode={mode} onError={onError} />;
  return <GoogleIdButton clientId={CLIENT_ID} mode={mode} onError={onError} />;
}

function GoogleIdButton({
  clientId,
  mode,
  onError,
}: {
  clientId: string;
  mode: "signin" | "link";
  onError: (message: string | null) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let nonce = { raw: "", hashed: "" };

    async function setUp() {
      const id = await loadGoogle();
      nonce = await makeNonce();
      if (cancelled || !slot.current) return;
      id.initialize({
        client_id: clientId,
        nonce: nonce.hashed,
        // A small pop-up window. (Chrome's FedCM prompt would replace it.)
        ux_mode: "popup",
        use_fedcm_for_button: false,
        callback: async ({ credential }) => {
          onError(null);
          const auth = supabase().auth;
          const { error } =
            mode === "signin"
              ? await auth.signInWithIdToken({ provider: "google", token: credential, nonce: nonce.raw })
              : await auth.linkIdentity({ provider: "google", token: credential, nonce: nonce.raw });
          if (error) onError(errorMessage(error));
          // A fresh nonce for the next attempt.
          if (!cancelled) setUp().catch(() => {});
        },
      });
      slot.current.replaceChildren();
      id.renderButton(slot.current, {
        theme: "outline",
        size: "large",
        text: mode === "signin" ? "continue_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 400, // Google's widest; CSS stretches it over the whole of ours
      });
    }

    setUp().catch((e) => {
      if (cancelled) return;
      setFailed(true);
      onError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, mode, onError]);

  // If Google's script can't load (blocked, offline), offer the redirect flow.
  if (failed) return <RedirectButton mode={mode} onError={onError} />;
  // Scrim's own button, with Google's (invisible) laid over it to take the click.
  return (
    <div className="google-wrap">
      <span aria-hidden className={`btn google-btn ${mode === "link" ? "btn-primary" : ""}`}>
        <GoogleLabel mode={mode} />
      </span>
      <div ref={slot} className="google-slot" />
    </div>
  );
}

/** Google's "G", in its own colours. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function GoogleLabel({ mode }: { mode: "signin" | "link" }) {
  return (
    <>
      <span className="google-logo">
        <GoogleLogo />
      </span>
      {mode === "signin" ? "Continue with Google" : "Link Google account"}
    </>
  );
}

/** Opens a small window centred over this one, like Google's own pop-up. */
function openPopup(): Window | null {
  const width = 500;
  const height = 640;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  return window.open("", "scrim-google-signin", `popup,width=${width},height=${height},left=${left},top=${top}`);
}

/**
 * Supabase's redirect flow: sign-in opens in a pop-up window that closes
 * itself when done (see /signed-in); linking uses this tab.
 */
function RedirectButton({ mode, onError }: { mode: "signin" | "link"; onError: (message: string | null) => void }) {
  async function signIn() {
    onError(null);
    // Open the window now, while the click still counts, or popup blockers step in.
    const popup = openPopup();
    try {
      const { data, error } = await supabase().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/signed-in`, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw error ?? new Error("Couldn't start Google sign-in.");
      if (popup) {
        popup.opener = null; // Google's pages get no handle on this window.
        popup.location.href = data.url;
      } else {
        window.location.href = data.url; // pop-up blocked: sign in here instead
      }
    } catch (e) {
      popup?.close();
      onError(errorMessage(e));
    }
  }

  async function link() {
    onError(null);
    const { error } = await supabase().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/profile` },
    });
    if (error) onError(errorMessage(error));
  }

  return (
    <button
      type="button"
      className={`btn google-btn ${mode === "link" ? "btn-primary" : ""}`}
      onClick={mode === "signin" ? signIn : link}
    >
      <GoogleLabel mode={mode} />
    </button>
  );
}
