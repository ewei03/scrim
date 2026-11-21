"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { customAdapter, type CustomGame } from "@/games/custom";
import { gameList } from "@/games/registry";
import { AuthError, Loading } from "@/components/RequireAuth";
import { GameTag, gameStyle } from "@/components/GameTag";
import { Modal } from "@/components/Modal";
import { SetupNotice } from "@/components/SetupNotice";
import { SignIn } from "@/components/SignIn";
import { Welcome } from "@/components/Welcome";
import { useAuth } from "@/lib/auth";
import { useExtension } from "@/lib/extension";
import { inviteCode } from "@/lib/invite";
import { inSavedOrder, savedGameOrder } from "@/lib/gameOrder";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { crewDayEnd, crewDeadline, crewPuzzle, localTimeZone } from "@/lib/rounds";
import { timeLeft } from "@/lib/time";
import type { Crew, Round } from "@/lib/types";

type OpenRound = Pick<Round, "crew_id" | "game" | "puzzle_id"> & { entries: { user_id: string }[] };
type CrewWithCount = Crew & {
  crew_members: { count: number }[];
  crew_games: { game: string }[];
  custom_games: CustomGame[];
};

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

const MAX_CREW_NAME = 16;
/**
 * Crews one account can be in at once, owned and joined together (join_crew
 * and create_crew enforce it). Guests can't make any.
 */
const MAX_CREWS = 4;

/**
 * "Sam's Crew", or "Sam's Crew 2", "Sam's Crew 3"… if the user already has a
 * crew by that name (case-insensitive). Stays within the name length limit.
 */
function suggestCrewName(displayName: string, crews: Pick<Crew, "name">[]): string {
  const taken = new Set(crews.map((c) => c.name.trim().toLowerCase()));
  // Long names don't fit "Name's Crew": try the first word, then "My Crew".
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  const base = [`${displayName.trim()}'s Crew`, `${first}'s Crew`].find((b) => b.length <= MAX_CREW_NAME - 3) ?? "My Crew";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const name = base.slice(0, MAX_CREW_NAME - suffix.length).trimEnd() + suffix;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function Dashboard() {
  const { user, profile, isGuest } = useAuth();
  const extension = useExtension();
  const router = useRouter();
  const [crews, setCrews] = useState<CrewWithCount[] | null>(null);
  const [open, setOpen] = useState<OpenRound[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // Runs after the Modal's own effect has opened the dialog, so focus sticks
  // (otherwise the dialog focuses its × button).
  useEffect(() => {
    if (creating) nameInput.current?.select();
  }, [creating]);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [c, l] = await Promise.all([
        sb.from("crews").select("*, crew_members(count), crew_games(game), custom_games(*)").order("created_at"),
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
    setSubmitting(true);
    setCreateError(null);
    try {
      const crew = await rpc<Crew>("create_crew", { p_name: name.trim(), p_timezone: localTimeZone() });
      // This page is kept (hidden) after navigating, so reset it for next time.
      setCreating(false);
      setName("");
      router.push(`/crew/${crew.invite_code}`);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Opening the invite link is what joins (or asks to join), so this just goes there.
  function joinCrew(e: React.FormEvent) {
    e.preventDefault();
    // The crew limit comes first, as on the server.
    if (crews && crews.length >= MAX_CREWS) return;
    const code = inviteCode(invite);
    if (!code) {
      setInviteError("That doesn't look like an invite link. It ends in /crew/ and a code.");
      return;
    }
    setInviteError(null);
    // This page is kept (hidden) after navigating, so reset it for next time.
    setInvite("");
    router.push(`/crew/${code}`);
  }

  if (!crews) return <Loading />;

  // Every crew you're in counts toward the limit, owned or joined (the
  // database enforces it). Guests can't make crews: they join with a link.
  const atLimit = crews.length >= MAX_CREWS;

  // Every game each crew plays, on the crew's own day.
  const now = new Date();
  const today = crews
    .flatMap((crew) =>
      // Built-in games, then the crew's own custom games, in the order you've
      // dragged them into on the crew's page.
      inSavedOrder(
        [...gameList(), ...crew.custom_games.map(customAdapter)].filter((game) =>
          crew.crew_games.some((g) => g.game === game.id),
        ),
        (game) => game.id,
        user ? savedGameOrder(user.id, crew.id) : [],
      ).map((game) => {
          const puzzleId = crewPuzzle(game, crew, now);
          const round = open.find((r) => r.crew_id === crew.id && r.game === game.id && r.puzzle_id === puzzleId);
          return {
            crew,
            game,
            puzzleId,
            deadline: crewDeadline(game, crew, now).toISOString(),
            // Shown on the row only when it differs from the crew's (shown once, by the crew's name).
            ownClock: crewDeadline(game, crew, now).getTime() !== crewDayEnd(crew, now).getTime(),
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
      {/* The setup guide starts with making a crew, which guests can't. */}
      {user && !isGuest && (
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
              <div className="row between today-crew-head">
                <h3 className="today-crew-name">
                  <Link href={`/crew/${crew.invite_code}`}>{crew.name}</Link>
                </h3>
                <span className="time-left">{timeLeft(crewDayEnd(crew, now).toISOString())} left</span>
              </div>
              <ul className="list list-live">
                {rows.map(({ game, puzzleId, deadline, ownClock, done }) => (
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
                        {ownClock && <span className="time-left">{timeLeft(deadline)} left</span>}
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
        <h2>
          Your crews ({crews.length}/{MAX_CREWS})
        </h2>
        {crews.length === 0 ? (
          <p className="muted">{isGuest ? "No crews yet. Join one with an invite link below." : "No crews yet. Start one!"}</p>
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
        <div className="row">
          <button
            className="btn btn-primary"
            aria-haspopup="dialog"
            disabled={isGuest || atLimit}
            aria-describedby={isGuest || atLimit ? "create-note" : undefined}
            onClick={() => {
              setCreateError(null);
              // Suggest a name; it's selected on open, so typing replaces it.
              setName(profile ? suggestCrewName(profile.display_name, crews) : "");
              setCreating(true);
            }}
          >
            Add a new crew
          </button>
        </div>
        <Modal open={creating} onClose={() => setCreating(false)} dismissOnBackdrop={false} title="New crew">
          <form className="stack" onSubmit={createCrew}>
            <input
              className="input input-plain"
              aria-label="Crew name"
              placeholder="Crew name"
              maxLength={MAX_CREW_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              ref={nameInput}
              required
            />
            {createError && <p className="error">{createError}</p>}
            <div className="row">
              <button className="btn btn-primary" disabled={submitting || !name.trim()}>
                Create crew
              </button>
            </div>
          </form>
        </Modal>
        {!isGuest && atLimit && (
          <p className="muted small" id="create-note">
            Max number of crews reached.
          </p>
        )}
        {isGuest && (
          <p className="muted small" id="create-note">
            <Link href="/profile">Sign in with Google</Link> to create a crew. Guests can join crews with an invite link.
          </p>
        )}
      </section>

      <section className="stack">
        <h2>Join a crew</h2>
        <form className="row" onSubmit={joinCrew}>
          <input
            className="input grow"
            aria-label="Invite link"
            placeholder="Paste an invite link"
            disabled={atLimit}
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setInviteError(null);
            }}
            aria-invalid={inviteError !== null}
            aria-describedby={inviteError ? "invite-error" : atLimit ? "join-note" : undefined}
          />
          <button className="btn" disabled={atLimit || !invite.trim()}>
            Join
          </button>
        </form>
        {inviteError && (
          <p className="error" id="invite-error">
            {inviteError}
          </p>
        )}
      </section>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
