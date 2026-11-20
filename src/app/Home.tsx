"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { gameList } from "@/games/registry";
import { AuthError, Loading } from "@/components/RequireAuth";
import { GameTag, gameStyle } from "@/components/GameTag";
import { SetupNotice } from "@/components/SetupNotice";
import { SignIn } from "@/components/SignIn";
import { Welcome } from "@/components/Welcome";
import { useAuth } from "@/lib/auth";
import { useExtension } from "@/lib/extension";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { crewDeadline, crewPuzzle, localTimeZone } from "@/lib/rounds";
import { timeLeft } from "@/lib/time";
import type { Crew, Round } from "@/lib/types";

type OpenRound = Pick<Round, "crew_id" | "game" | "puzzle_id"> & { entries: { user_id: string }[] };
type CrewWithCount = Crew & { crew_members: { count: number }[]; crew_games: { game: string }[] };

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
    <div className="stack-lg page-enter">
      <section className="hero">
        <h1>
          DAILY PUZZLE
          <br />
          SHOWDOWNS.
        </h1>
        <p>Turn your daily puzzles into a competition!</p>
      </section>
      <ol className="steps">
        <li>Start a crew with your friends</li>
        <li>Play your favourite games</li>
        <li>Beat your friends and earn bragging rights!</li>
      </ol>
      <SignIn title="Start scrimming" />
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const extension = useExtension();
  const router = useRouter();
  const [crews, setCrews] = useState<CrewWithCount[] | null>(null);
  const [open, setOpen] = useState<OpenRound[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [c, l] = await Promise.all([
        sb.from("crews").select("*, crew_members(count), crew_games(game)").order("created_at"),
        sb
          .from("rounds")
          .select("crew_id, game, puzzle_id, entries(user_id)")
          .gt("closes_at", new Date().toISOString()),
      ]);
      if (c.error || l.error) setError(errorMessage(c.error ?? l.error));
      setCrews((c.data as CrewWithCount[]) ?? []);
      setOpen((l.data as OpenRound[]) ?? []);
    })();
  }, []);

  async function createCrew(e: React.FormEvent) {
    e.preventDefault();
    try {
      const crew = await rpc<Crew>("create_crew", { p_name: name, p_timezone: localTimeZone() });
      router.push(`/crew/${crew.invite_code}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!crews) return <Loading />;

  // Every game each crew plays, on the crew's own day.
  const now = new Date();
  const today = crews
    .flatMap((crew) =>
      gameList()
        .filter((game) => crew.crew_games.some((g) => g.game === game.id))
        .map((game) => {
          const puzzleId = crewPuzzle(game, crew, now);
          const round = open.find((r) => r.crew_id === crew.id && r.game === game.id && r.puzzle_id === puzzleId);
          return {
            crew,
            game,
            puzzleId,
            deadline: crewDeadline(game, crew, now).toISOString(),
            done: Boolean(round?.entries.some((e) => e.user_id === user?.id)),
          };
        }),
    )
    // Still to play first.
    .sort((a, b) => Number(a.done) - Number(b.done));

  // Grouped by crew. Crews with something left to play come first; otherwise
  // crews keep their usual order.
  const todayByCrew = crews
    .map((crew) => ({ crew, rows: today.filter((t) => t.crew.id === crew.id) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => Number(a.rows.every((r) => r.done)) - Number(b.rows.every((r) => r.done)));

  return (
    <div className="stack-lg page-enter">
      {user && (
        <Welcome
          userId={user.id}
          accountCreatedAt={user.created_at}
          extension={extension.state}
          hasCrew={crews.length > 0}
          hasGames={crews.some((c) => c.crew_games.length > 0)}
        />
      )}
      {today.length > 0 && (
        <section className="stack">
          <h2>Today</h2>
          {todayByCrew.map(({ crew, rows }) => (
            <div key={crew.id} className="today-crew">
              <h3 className="today-crew-name">
                <Link href={`/crew/${crew.invite_code}`}>{crew.name}</Link>
              </h3>
              <ul className="list list-live">
                {rows.map(({ game, puzzleId, deadline, done }) => (
                  <li key={game.id}>
                    <Link
                      href={`/crew/${crew.invite_code}`}
                      className={`list-row ${done ? "" : "todo"}`}
                      style={gameStyle(game)}
                    >
                      <span>
                        <span className="live-dot" aria-hidden>●</span>
                        <GameTag game={game} /> <strong>{game.puzzleLabel(puzzleId)}</strong>
                      </span>
                      <span className="row">
                        <span className="time-left">{timeLeft(deadline)} left</span>
                        {done ? (
                          <span className="pill pill-done">done</span>
                        ) : (
                          <span className="pill pill-hot">play</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="stack">
        <h2>Your crews</h2>
        {crews.length === 0 ? (
          <p className="muted">No crews yet. Start one!</p>
        ) : (
          <ul className="crew-grid">
            {crews.map((c) => {
              const members = c.crew_members[0]?.count ?? 0;
              return (
                <li key={c.id}>
                  <Link href={`/crew/${c.invite_code}`} className="crew-card">
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
