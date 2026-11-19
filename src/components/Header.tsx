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
          <Link href="/me" className="whoami">
            {profile.display_name}
            {isGuest && <span className="tag">guest</span>}
          </Link>
        )}
      </div>
    </header>
  );
}
