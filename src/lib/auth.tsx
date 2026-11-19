"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { errorMessage, isConfigured, supabase } from "./supabase";
import type { Profile } from "./types";

type Status = "loading" | "signedOut" | "signedIn" | "unconfigured" | "error";

type AuthState = {
  status: Status;
  user: User | null;
  profile: Profile | null;
  /** Set when signed in but the profile couldn't be loaded (status "error"). */
  error: string | null;
  isGuest: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still waiting for the initial session
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<{ userId: string; message: string } | null>(null);

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
    if (!userId) return;
    const result = await fetchProfile(userId);
    if ("profile" in result) setProfile(result.profile);
    else setProfileError({ userId, message: result.error });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchProfile(userId).then((result) => {
      if (cancelled) return;
      if ("profile" in result) setProfile(result.profile);
      else setProfileError({ userId, message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  let status: Status;
  if (!isConfigured) status = "unconfigured";
  else if (user === undefined) status = "loading";
  else if (user === null) status = "signedOut";
  else if (profile?.id === user.id) status = "signedIn";
  else if (profileError?.userId === user.id) status = "error";
  else status = "loading"; // profile request still in flight

  return (
    <AuthContext.Provider
      value={{
        status,
        user: user ?? null,
        profile: status === "signedIn" ? profile : null,
        error: status === "error" ? (profileError?.message ?? null) : null,
        isGuest: Boolean(user?.is_anonymous),
        refreshProfile: loadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function fetchProfile(userId: string): Promise<{ profile: Profile } | { error: string }> {
  try {
    const { data, error } = await supabase()
      .from("profiles")
      .select("id, display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) return { error: describeProfileError(error.message) };
    if (!data) return { error: "Your profile is missing. Run supabase/migrations/0002_table_grants.sql, then reload." };
    return { profile: data };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

function describeProfileError(message: string): string {
  if (/permission denied/i.test(message)) {
    return `The database refused access (${message}). Run supabase/migrations/0002_table_grants.sql in the Supabase SQL editor, then reload.`;
  }
  if (/does not exist|could not find the table/i.test(message)) {
    return `The database tables are missing (${message}). Run the SQL files in supabase/migrations in order, then reload.`;
  }
  return message;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
