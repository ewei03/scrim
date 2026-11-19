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
type CrewWithCount = Crew & { crew_members: { count: number }[] };

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
        <li>Finish the game and your score lands automatically — others stay hidden until you have</li>
        <li>The lobby crowns a winner, stats keep score forever</li>
      </ol>
      <SignIn title="Jump in" />
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [crews, setCrews] = useState<CrewWithCount[] | null>(null);
  const [open, setOpen] = useState<OpenLobby[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [c, l] = await Promise.all([
        sb.from("crews").select("*, crew_members(count)").order("created_at"),
        sb
          .from("lobbies")
          .select("*, crews(name), entries(user_id)")
          .is("closed_at", null)
          .gt("closes_at", new Date().toISOString())
          .order("closes_at"),
      ]);
      if (c.error || l.error) setError(errorMessage(c.error ?? l.error));
      setCrews((c.data as CrewWithCount[]) ?? []);
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
          <ul className="list list-live">
            {open.map((l) => {
              const game = getGame(l.game);
              const done = l.entries.some((e) => e.user_id === user?.id);
              return (
                <li key={l.id}>
                  <Link href={`/l/${l.invite_code}`} className={`list-row ${done ? "" : "todo"}`}>
                    <span>
                      <span className="live-dot" aria-hidden>●</span>
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
          <ul className="crew-grid">
            {crews.map((c) => {
              const members = c.crew_members[0]?.count ?? 0;
              return (
                <li key={c.id}>
                  <Link href={`/c/${c.invite_code}`} className="crew-card">
                    <span className="crew-name">{c.name}</span>
                    <span className="crew-meta">
                      <span>
                        {members} {members === 1 ? "member" : "members"}
                      </span>
                      <span aria-hidden>→</span>
                    </span>
                  </Link>
                </li>
              );
            })}
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
