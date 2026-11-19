"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isConfigured, supabase } from "./supabase";
import type { Profile } from "./types";

type Status = "loading" | "signedOut" | "signedIn" | "unconfigured";

type AuthState = {
  status: Status;
  user: User | null;
  profile: Profile | null;
  isGuest: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still waiting for the initial session
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    // Fires INITIAL_SESSION right away, then on every sign-in/out/link.
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = user?.id;
  const loadProfile = useCallback(async () => {
    if (!userId) return setProfile(null);
    const { data } = await supabase().from("profiles").select("id, display_name").eq("id", userId).single();
    setProfile(data);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      const { data } = await supabase().from("profiles").select("id, display_name").eq("id", userId).single();
      if (!cancelled) setProfile(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  let status: Status;
  if (!isConfigured) status = "unconfigured";
  else if (user === undefined) status = "loading";
  else if (user === null) status = "signedOut";
  else if (profile?.id !== user.id) status = "loading";
  else status = "signedIn";

  return (
    <AuthContext.Provider
      value={{
        status,
        user: user ?? null,
        profile: status === "signedIn" ? profile : null,
        isGuest: Boolean(user?.is_anonymous),
        refreshProfile: loadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
