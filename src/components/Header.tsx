"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { HelpButton } from "./HelpButton";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The favicon's S (src/app/icon.svg) standing in for the logo's first letter.
 * It's Share Tech Mono's own S outline, in the font's units (1000 to the em,
 * baseline at 0, 540 wide), plus arrowheads, so drawn at 1em to 1000 units it
 * sits exactly where the letter would: same size, same baseline, same width
 * (the CSS trims the arrowheads' overhang back to the 540 advance).
 */
function LogoS() {
  return (
    <svg className="logo-s" viewBox="-13 -762 566 824" aria-hidden focusable="false">
      <path
        transform="scale(1 -1)"
        fill="currentColor"
        d="M259 0H117V-62L-13 38L117 138V76H269Q306 76 329 98Q352 120 352 151V255Q352 285 336.5 303.5Q321 322 290 322H260Q186 322 143 365.5Q100 409 100 492V530Q100 615 146.5 657.5Q193 700 280 700H423V762L553 662L423 562V624H270Q233 624 210 602Q187 580 187 549V473Q187 442 207 421.5Q227 401 259 401H289Q360 401 399.5 360Q439 319 439 236V170Q439 85 392.5 42.5Q346 0 259 0Z"
      />
    </svg>
  );
}

export function Header() {
  const { profile, isGuest } = useAuth();
  return (
    <header className="site-header">
      <Link href="/" className="logo" aria-label="SCRIM home">
        <LogoS />
        CRIM<span className="cursor">_</span>
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
