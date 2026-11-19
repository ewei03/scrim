import type { Metadata } from "next";
import { IBM_Plex_Mono, VT323 } from "next/font/google";
import { Header } from "@/components/Header";
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
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <AuthProvider>
          <Header />
          <main className="container">{children}</main>
          <footer className="container footer muted small">
            Scrim is an independent fan project, not affiliated with any game it supports.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
