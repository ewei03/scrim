import type { Metadata } from "next";
import { Fira_Code, Noto_Color_Emoji, Share_Tech_Mono } from "next/font/google";
import Link from "next/link";
import { Header } from "@/components/Header";
import { SuggestGameLink } from "@/components/SuggestGame";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const display = Share_Tech_Mono({ weight: "400", subsets: ["latin"], variable: "--font-display" });
// Variable font: covers the 400/600/700 weights the CSS uses.
const body = Fira_Code({ subsets: ["latin"], variable: "--font-body" });
// Last-resort emoji for devices with no emoji font of their own (they'd see
// boxes). Split by unicode-range and not preloaded, so it only downloads the
// pieces a page actually needs, and only when the system fonts can't draw them.
const emoji = Noto_Color_Emoji({ weight: "400", subsets: ["emoji"], preload: false, variable: "--font-emoji" });

export const metadata: Metadata = {
  title: "Scrim - daily puzzles with friends",
  description: "Compete with friends on daily browser games. Start a crew, share the link, play, compare.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script and the Chrome extension both
    // set attributes on <html> before React hydrates.
    <html lang="en" className={`${display.variable} ${body.variable} ${emoji.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <Header />
          <main className="container">{children}</main>
          <footer className="container footer muted small">
            <span>
              Made by{" "}
              <a href="https://x.com/eggnonk" target="_blank" rel="noreferrer">
                @eggnonk
              </a>.
              <br />
              Scrim is an independent fan project, not affiliated with any game it supports.
            </span>
            <nav>
              <Link href="/games">Games</Link>
              <SuggestGameLink />
              <a href="https://github.com/ewei03/scrim" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <Link href="/privacy">Privacy &amp; Terms</Link>
            </nav>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
