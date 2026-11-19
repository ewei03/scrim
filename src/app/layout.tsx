import type { Metadata } from "next";
import { IBM_Plex_Mono, VT323 } from "next/font/google";
import Link from "next/link";
import { Header } from "@/components/Header";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const display = VT323({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Scrim — daily puzzle showdowns",
  description: "Compete with friends on daily browser games. Create a lobby, share the link, play, compare.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script and the Chrome extension both
    // set attributes on <html> before React hydrates.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <Header />
          <main className="container">{children}</main>
          <footer className="container footer muted small">
            <span>Scrim is an independent fan project, not affiliated with any game it supports.</span>
            <nav>
              <a href="https://github.com/ewei03/scrim" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <Link href="/privacy">Privacy</Link>
            </nav>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
