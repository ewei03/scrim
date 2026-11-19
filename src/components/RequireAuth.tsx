"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { SetupNotice } from "./SetupNotice";
import { SignIn } from "./SignIn";

export function RequireAuth({ children, title }: { children: ReactNode; title?: string }) {
  const { status, error } = useAuth();
  if (status === "unconfigured") return <SetupNotice />;
  if (status === "error") return <AuthError message={error} />;
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <SignIn title={title} />;
  return children;
}

export function AuthError({ message }: { message: string | null }) {
  return (
    <div className="card stack">
      <h2>Can&apos;t load your profile</h2>
      <p className="error">{message ?? "Something went wrong."}</p>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <p className="muted blink">{label}…</p>;
}
