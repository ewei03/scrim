"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getGame } from "@/games/registry";
import { AuthError, Loading } from "@/components/RequireAuth";
import { SetupNotice } from "@/components/SetupNotice";
import { SignIn } from "@/components/SignIn";
import { useAuth } from "@/lib/auth";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { timeLeft } from "@/lib/time";
import type { Crew, Lobby } from "@/lib/types";

type OpenLobby = Lobby & { crews: { name: string }; entries: { user_id: string }[] };

export function Home() {
  const { status, error } = useAuth();
  if (status === "unconfigured") return <SetupNotice />;
  if (status === "error") return <AuthError message={error} />;
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <Landing />;
  return <Dashboard />;
}

function Landing() {
  return (
    <div className="stack-lg">
      <section className="hero">
        <h1>
          DAILY PUZZLE
          <br />
          SHOWDOWNS.
        </h1>
        <p>Same puzzle. Your friends. One winner.</p>
      </section>
      <ol className="steps">
        <li>Start a crew and a lobby</li>
        <li>Share the invite link</li>
        <li>Everyone plays on their own time</li>
        <li>Paste your result — scores stay hidden until you do</li>
        <li>The lobby crowns a winner, stats keep score forever</li>
      </ol>
      <SignIn title="Jump in" />
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [crews, setCrews] = useState<Crew[] | null>(null);
  const [open, setOpen] = useState<OpenLobby[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [c, l] = await Promise.all([
        sb.from("crews").select("*").order("created_at"),
        sb
          .from("lobbies")
          .select("*, crews(name), entries(user_id)")
          .is("closed_at", null)
          .gt("closes_at", new Date().toISOString())
          .order("closes_at"),
      ]);
      if (c.error || l.error) setError(errorMessage(c.error ?? l.error));
      setCrews(c.data ?? []);
      setOpen((l.data as OpenLobby[]) ?? []);
    })();
  }, []);

  async function createCrew(e: React.FormEvent) {
    e.preventDefault();
    try {
      const crew = await rpc<Crew>("create_crew", { p_name: name });
      router.push(`/c/${crew.invite_code}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!crews) return <Loading />;

  return (
    <div className="stack-lg">
      {open.length > 0 && (
        <section className="stack">
          <h2>Open lobbies</h2>
          <ul className="list">
            {open.map((l) => {
              const game = getGame(l.game);
              const done = l.entries.some((e) => e.user_id === user?.id);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className="list-row">
                    <span>
                      <strong>
                        {game.name} {game.puzzleLabel(l.puzzle_id)}
                      </strong>{" "}
                      <span className="muted">· {l.crews.name}</span>
                    </span>
                    <span className="row">
                      <span className="muted small">{timeLeft(l.closes_at)} left</span>
                      {done ? <span className="pill">✓ in</span> : <span className="pill pill-hot">play</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="stack">
        <h2>Your crews</h2>
        {crews.length === 0 ? (
          <p className="muted">No crews yet. Start one, or open an invite link from a friend.</p>
        ) : (
          <ul className="list">
            {crews.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.invite_code}`} className="list-row">
                  <strong>{c.name}</strong>
                  <span className="muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form className="row" onSubmit={createCrew}>
          <input
            className="input grow"
            placeholder="New crew name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="btn btn-primary" disabled={!name.trim()}>
            Create crew
          </button>
        </form>
      </section>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
