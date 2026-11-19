"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { SetupNotice } from "./SetupNotice";
import { SignIn } from "./SignIn";

export function RequireAuth({ children, title }: { children: ReactNode; title?: string }) {
  const { status } = useAuth();
  if (status === "unconfigured") return <SetupNotice />;
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <SignIn title={title} />;
  return children;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <p className="muted blink">{label}…</p>;
}
