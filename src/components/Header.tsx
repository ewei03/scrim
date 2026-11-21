"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { HelpButton } from "./HelpButton";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const { profile, isGuest } = useAuth();
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        SCRIM<span className="cursor">_</span>
      </Link>
      <div className="header-actions">
        <HelpButton />
        <ThemeToggle />
        {profile && (
          <Link href="/profile" className="btn btn-small whoami" title="Your profile">
            {profile.display_name}
            {isGuest && <span className="tag">guest</span>}
            <span className="whoami-arrow" aria-hidden>
              →
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
