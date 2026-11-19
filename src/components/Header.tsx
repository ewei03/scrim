"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Header() {
  const { profile, isGuest } = useAuth();
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        SCRIM<span className="cursor">_</span>
      </Link>
      {profile && (
        <Link href="/me" className="whoami">
          {profile.display_name}
          {isGuest && <span className="tag">guest</span>}
        </Link>
      )}
    </header>
  );
}
