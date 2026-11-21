"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CopyLink } from "@/components/CopyLink";
import { CustomGameForm } from "@/components/CustomGameForm";
import { GameTag, gameStyle } from "@/components/GameTag";
import { Modal } from "@/components/Modal";
import { Rankings } from "@/components/Rankings";
import { Loading, RequireAuth } from "@/components/RequireAuth";
import { Scoreboard } from "@/components/Scoreboard";
import { SubmitPanel } from "@/components/SubmitPanel";
import { rankEntries } from "@/games/ranking";
import { customAdapter, customGameId, customOf, type CustomGame } from "@/games/custom";
import { gameList, getGame } from "@/games/registry";
import type { GameAdapter } from "@/games/types";
import { useAuth } from "@/lib/auth";
import { askExtension, useExtension, type ExtensionState } from "@/lib/extension";
import { crewDayEnd, crewDeadline, crewPuzzle, localTimeZone, roundZone } from "@/lib/rounds";
import { crewStats } from "@/lib/stats";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { formatDay, timeLeft } from "@/lib/time";
import { zoneGroups } from "@/lib/timezones";
import { isClosed, type BoardRow, type Crew, type EntrySource, type Round } from "@/lib/types";

const POLL_MS = 10_000;

type Member = { user_id: string; profiles: { display_name: string; is_guest: boolean } };
type RoundWithEntries = Round & {
  entries: {
    id: string;
    user_id: string;
    result: unknown;
    source: EntrySource;
    submitted_at: string;
    profiles: { display_name: string } | null;
  }[];
};

export function CrewView() {
  return (
    <RequireAuth title="You've been invited to a crew">
      <CrewPage />
    </RequireAuth>
  );
}

const REFRESH_MS = 20_000;

/** The crew was deleted, or you're not in it any more (left elsewhere, or removed). */
class CrewGoneError extends Error {}

/**
 * Opening a crew link joins the crew, so the first load (join) doubles as the
 * invite handler. Refreshes only read: re-joining would quietly put back
 * someone who left the crew in another tab or on another device.
 */
async function fetchCrew(code: string, join: boolean) {
  const sb = supabase();
  let crew: Crew;
  if (join) {
    crew = await rpc<Crew>("join_crew", { p_code: code });
  } else {
    const { data, error } = await sb.from("crews").select("*").eq("invite_code", code.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!data) throw new CrewGoneError();
    crew = data as Crew;
  }
  const [m, g, cg, r] = await Promise.all([
    sb.from("crew_members").select("user_id, profiles(display_name, is_guest)").eq("crew_id", crew.id).order("joined_at"),
    sb.from("crew_games").select("game").eq("crew_id", crew.id),
    sb.from("custom_games").select("*").eq("crew_id", crew.id).order("created_at"),
    sb
      .from("rounds")
      .select("*, entries(id, user_id, result, source, submitted_at, profiles(display_name))")
      .eq("crew_id", crew.id)
      .order("closes_at", { ascending: false }),
  ]);
  if (m.error || g.error || cg.error || r.error) throw m.error ?? g.error ?? cg.error ?? r.error;
  return {
    crew,
    members: m.data as unknown as Member[],
    games: (g.data as { game: string }[]).map((x) => x.game),
    customGames: cg.data as CustomGame[],
    rounds: r.data as RoundWithEntries[],
  };
}

function CrewPage() {
  const { code } = useParams<{ code: string }>();
  const { user, isGuest } = useAuth();
  const router = useRouter();
  const extension = useExtension();
  const [crew, setCrew] = useState<Crew | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [games, setGames] = useState<string[]>([]);
  const [customGames, setCustomGames] = useState<CustomGame[]>([]);
  const [rounds, setRounds] = useState<RoundWithEntries[]>([]);
  const [showManage, setShowManage] = useState(false);
  // The custom game form: null when closed, "new" when adding one, or the game being edited.
  const [editing, setEditing] = useState<CustomGame | "new" | null>(null);
  const [rankingsGame, setRankingsGame] = useState<string | null>(null);
  // Bumped to make today's boards refetch.
  const [boardsKey, setBoardsKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    (join = false) =>
      fetchCrew(code, join).then(
        (d) => {
          setCrew(d.crew);
          setMembers(d.members);
          setGames(d.games);
          setCustomGames(d.customGames);
          setRounds(d.rounds);
          setError(null);
        },
        (e) => (e instanceof CrewGoneError ? setGone(true) : setError(errorMessage(e))),
      ),
    [code],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Keep members, games, rankings and past days current: every so often while
  // the page is visible, and when you come back to it. (Today's scoreboards
  // poll on their own, more often.)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  async function refreshNow() {
    setRefreshing(true);
    // Saved results from the extension too, in case one hasn't come through.
    const synced = extension.state === "connected" ? askExtension("sync") : Promise.resolve(null);
    await Promise.all([load(), synced]);
    setBoardsKey((k) => k + 1);
    setRefreshing(false);
  }

  // Tick for countdowns. When the crew's day rolls over, the old rounds move
  // into the history.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);
  // Built-in games, then the crew's own custom games.
  const allGames = useMemo(() => [...gameList(), ...customGames.map(customAdapter)], [customGames]);
  const findGame = useCallback((id: string) => allGames.find((g) => g.id === id) ?? getGame(id), [allGames]);

  const today = crew ? `${crew.timezone}:${games.map((g) => crewPuzzle(findGame(g), crew, new Date(now))).join()}` : "";
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current && lastToday.current !== today) load();
    lastToday.current = today;
  }, [today, load]);

  // Crews from before time zones existed have none: use the owner's.
  const needsZone = crew !== null && crew.timezone === null && crew.created_by === user?.id;
  useEffect(() => {
    if (!needsZone || !crew) return;
    rpc<Crew>("update_crew_settings", { p_crew: crew.id, p_timezone: localTimeZone() }).then(setCrew, () => {});
  }, [needsZone, crew]);

  // If you played before joining, or before the crew picked the game, the
  // extension still has your result: ask it to submit now, and again whenever
  // the crew's games change, so a game you just added shows your score.
  const autoSubmit = extension.state === "connected";
  const gamesKey = games.join();
  useEffect(() => {
    if (!autoSubmit || !crew?.id || !gamesKey) return;
    askExtension<{ ok: boolean; submitted?: number }>("sync").then((reply) => {
      if (reply?.submitted) setBoardsKey((k) => k + 1);
    });
  }, [autoSubmit, crew?.id, gamesKey]);

  // Members first, then anyone who has left but still appears in the history.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rounds) for (const e of r.entries) if (e.profiles) map.set(e.user_id, e.profiles.display_name);
    for (const m of members) map.set(m.user_id, m.profiles.display_name);
    return map;
  }, [rounds, members]);

  // Rounds nobody finished aren't worth showing.
  const finished = useMemo(() => rounds.filter((r) => isClosed(r, now) && r.entries.length > 0), [rounds, now]);

  const statsByGame = useMemo(() => {
    const memberIds = members.map((m) => m.user_id);
    return allGames
      .map((game) => {
        const played = finished.filter((r) => r.game === game.id);
        return { game, count: played.length, ...crewStats(game, played, memberIds) };
      })
      .filter((s) => s.count > 0);
  }, [finished, members, allGames]);

  if (gone) {
    return (
      <div className="card stack">
        <h1>Crew not available</h1>
        <p>This crew was deleted, or you&apos;re no longer a member.</p>
        <Link href="/" className="btn btn-primary back-home-btn">
          ← Back to Scrim
        </Link>
      </div>
    );
  }
  if (error && !crew) return <p className="error">{error}</p>;
  if (!crew) return <Loading />;

  const isOwner = crew.created_by === user?.id;
  // Games with finished rounds; defaults to the first until one is picked.
  const ranked = statsByGame.find((s) => s.game.id === rankingsGame) ?? statsByGame[0];
  const tracked = allGames.filter((g) => games.includes(g.id));
  // Custom games with scores in them have their scoring locked.
  const playedGames = new Set(rounds.filter((rd) => rd.entries.length > 0).map((rd) => rd.game));

  async function voidEntry(name: string, entryId: string) {
    if (!confirm(`Void ${name}'s entry? They'll be able to submit again while the day is still on.`)) return;
    try {
      await rpc("void_entry", { p_entry: entryId });
      setBoardsKey((k) => k + 1);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function leave() {
    if (!crew || !confirm(`Leave ${crew.name}? Your results for today are removed. You can rejoin with the invite link.`))
      return;
    try {
      await rpc("leave_crew", { p_crew: crew.id });
      // Have the extension drop this crew from its saved results.
      askExtension("sync");
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="stack-lg page-enter">
      <section className="crew-plate">
        <p className="crew-plate-bar">
          <span>Crew</span>
          <span>
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </p>
        <div className="crew-plate-body">
          <div className="row between wrap">
            <h1>{crew.name}</h1>
            <div className="row">
              <CopyLink path={`/crew/${crew.invite_code}`} label="Invite to crew" />
              {isOwner ? (
                <button
                  className="icon-btn icon-btn-raised"
                  aria-label="Manage crew"
                  aria-haspopup="dialog"
                  title="Manage crew"
                  onClick={() => setShowManage(true)}
                >
                  ⚙
                </button>
              ) : (
                <button className="link-btn danger" onClick={leave}>
                  Leave
                </button>
              )}
            </div>
          </div>
          <ul className="member-chips">
            {members.map((m) => (
              <li key={m.user_id} className={m.user_id === user?.id ? "me" : undefined}>
                {m.profiles.display_name}
                {m.profiles.is_guest && <span className="guest-tag"> (guest)</span>}
              </li>
            ))}
          </ul>
          <CrewGames
            crew={crew}
            games={games}
            allGames={allGames}
            isOwner={isOwner}
            onGames={setGames}
            onAddCustom={() => setEditing("new")}
          />
        </div>
        {isOwner && (
          <Modal
            open={editing !== null}
            onClose={() => setEditing(null)}
            dismissOnBackdrop={false}
            title={editing && editing !== "new" ? `Edit ${editing.name}` : "Add a custom game"}
          >
            {editing !== null && (
              <CustomGameForm
                key={editing === "new" ? "new" : editing.id}
                crewId={crew.id}
                game={editing === "new" ? undefined : editing}
                takenColors={allGames.map((g) => g.color)}
                scoringLocked={editing !== "new" && playedGames.has(customGameId(editing.id))}
                onSaved={(saved) => {
                  const isNew = editing === "new";
                  setCustomGames((list) =>
                    isNew ? [...list, saved] : list.map((g) => (g.id === saved.id ? saved : g)),
                  );
                  // A new custom game is played straight away (the server adds it).
                  if (isNew) {
                    rememberCollapsed(crew.id, customGameId(saved.id), false);
                    setGames((list) => [...list, customGameId(saved.id)]);
                  }
                  setEditing(null);
                }}
                onDeleted={(gone) => {
                  setCustomGames((list) => list.filter((g) => g.id !== gone.id));
                  setGames((list) => list.filter((g) => g !== customGameId(gone.id)));
                  setEditing(null);
                  load(); // its past days and rankings are gone too
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </Modal>
        )}
        {isOwner && (
          <Modal open={showManage} onClose={() => setShowManage(false)} title="Manage crew">
            <ManageCrew
              crew={crew}
              members={members}
              onCrew={setCrew}
              onRemoved={() => {
                setBoardsKey((k) => k + 1);
                load();
              }}
              onDeleted={() => setShowManage(false)}
            />
          </Modal>
        )}
      </section>

      {isGuest && !isOwner && (
        <p className="card small guest-note">
          You&apos;re playing as a guest: you&apos;ll leave this crew, and your scores here are removed, a day after
          you joined. <Link href="/profile">Link a Google account</Link> to stay.
        </p>
      )}

      <section className="stack">
        <div className="row between">
          <div className="row today-head">
            <h2>Today</h2>
            {/* Every game's day ends together, at the crew's midnight (games on another clock say so on their card). */}
            {tracked.length > 0 && (
              <span className="time-left">
                <span className="live-dot" aria-hidden>
                  ●
                </span>
                {timeLeft(crewDayEnd(crew, new Date(now)).toISOString(), now)} left
              </span>
            )}
          </div>
          <button className="btn btn-small" disabled={refreshing} onClick={refreshNow}>
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        {tracked.length === 0 ? (
          isOwner ? (
            <p className="card">
              Click on a game in the Crew tab to get started.
            </p>
          ) : (
            <p className="muted">The crew owner hasn&apos;t picked any games yet.</p>
          )
        ) : (
          tracked.map((game) => (
            <TodayRound
              key={game.id}
              crew={crew}
              game={game}
              now={now}
              isOwner={isOwner}
              extension={extension.state}
              refreshKey={boardsKey}
              onEdit={isOwner && customOf(game) ? () => setEditing(customOf(game)) : undefined}
              onVoid={(row) => voidEntry(row.display_name, row.entry_id)}
            />
          ))
        )}
      </section>

      {ranked && (
        <section className="stack">
          <div className="row between wrap">
            <h2>
              Rankings <span className="muted small">· {ranked.count} played</span>
            </h2>
            <select
              className="input rankings-game"
              aria-label="Game"
              value={ranked.game.id}
              onChange={(e) => setRankingsGame(e.target.value)}
            >
              {statsByGame.map(({ game }) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </div>
          <Rankings game={ranked.game} players={ranked.players} names={names} />
        </section>
      )}

      <section className="stack">
        <h2>Archive</h2>
        {finished.length === 0 ? (
          <p className="muted">Results from previous days will show up here.</p>
        ) : (
          <ul className="list list-archive">
            {finished.map((r) => (
              <PastRound
                game={findGame(r.game)}
                key={r.id}
                round={r}
                names={names}
                isOwner={isOwner}
                onVoid={(row) => voidEntry(row.display_name, row.entry_id)}
              />
            ))}
          </ul>
        )}
      </section>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Today's scoreboard for one game. The round starts with the first result. */
function TodayRound({
  crew,
  game,
  now,
  isOwner,
  extension,
  refreshKey,
  onEdit,
  onVoid,
}: {
  crew: Crew;
  game: GameAdapter<unknown>;
  now: number;
  isOwner: boolean;
  extension: ExtensionState;
  refreshKey: number;
  /** Set for the owner on a custom game: opens its settings. */
  onEdit?: () => void;
  onVoid: (row: BoardRow) => void;
}) {
  const { user } = useAuth();
  const puzzleId = crewPuzzle(game, crew, new Date(now));
  const ends = crewDeadline(game, crew, new Date(now));
  const deadline = ends.toISOString();
  // Shown on the card only when this game's day doesn't end with the crew's (e.g. Krillion, on New York time).
  const ownClock = ends.getTime() !== crewDayEnd(crew, new Date(now)).getTime();
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(() => !isCollapsed(crew.id, game.id));
  const bodyId = useId();

  function toggle() {
    rememberCollapsed(crew.id, game.id, open);
    setOpen(!open);
  }

  const loadBoard = useCallback(
    () =>
      rpc<BoardRow[]>("get_round_board", { p_crew: crew.id, p_game: game.id, p_puzzle: puzzleId }).then(
        (rows) => {
          setBoard(rows);
          setError(null);
        },
        (e) => setError(errorMessage(e)),
      ),
    [crew.id, game.id, puzzleId],
  );

  useEffect(() => {
    loadBoard();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadBoard();
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [loadBoard, refreshKey]);

  const submitted = board.some((r) => r.user_id === user?.id);

  return (
    <article className={`game-card ${open ? "" : "collapsed"}`} style={gameStyle(game)}>
      <header className="game-card-bar">
        <h3 className="today-title">
          <button type="button" className="game-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <span className="game-card-chevron" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
            {game.name} <span className="game-card-puzzle">{game.puzzleLabel(puzzleId)}</span>
          </button>
        </h3>
        <div className="game-card-right">
          {!open && (
            <span className="game-card-summary">
              {submitted ? "✓ You're in" : "Your turn"} · {board.length} played
            </span>
          )}
          {ownClock && (
            <span className="time-left" title={`${game.name} runs on ${roundZone(game, crew).replaceAll("_", " ")} time`}>
              <span className="live-dot" aria-hidden>
                ●
              </span>
              {timeLeft(deadline, now)} left
            </span>
          )}
          {onEdit && (
            <button
              type="button"
              className="game-card-edit"
              onClick={onEdit}
              title={`Edit ${game.name}`}
              aria-label={`Edit ${game.name}`}
            >
              ✎
            </button>
          )}
        </div>
      </header>
      <div className="game-card-body stack" id={bodyId} hidden={!open}>
        {!submitted && (
          <SubmitPanel crew={crew} game={game} puzzleId={puzzleId} extension={extension} onSubmitted={loadBoard} />
        )}
        <Scoreboard game={game} rows={board} closed={false} canVoid={isOwner} onVoid={onVoid} />
        {error && <p className="error small">{error}</p>}
      </div>
    </article>
  );
}

/** Which of today's games you've collapsed, per crew, in this browser. */
const collapsedKey = (crewId: string, gameId: string) => `scrim-collapsed:${crewId}:${gameId}`;

function isCollapsed(crewId: string, gameId: string): boolean {
  try {
    return localStorage.getItem(collapsedKey(crewId, gameId)) !== null;
  } catch {
    return false;
  }
}

function rememberCollapsed(crewId: string, gameId: string, collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(collapsedKey(crewId, gameId), "1");
    else localStorage.removeItem(collapsedKey(crewId, gameId));
  } catch {
    // Storage blocked: it just won't be remembered.
  }
}

function PastRound({
  game,
  round,
  names,
  isOwner,
  onVoid,
}: {
  game: GameAdapter<unknown>;
  round: RoundWithEntries;
  names: Map<string, string>;
  isOwner: boolean;
  onVoid: (row: BoardRow) => void;
}) {
  const winners = rankEntries(game, round.entries).filter((e) => e.winner);
  const rows: BoardRow[] = round.entries.map((e) => ({
    entry_id: e.id,
    user_id: e.user_id,
    display_name: names.get(e.user_id) ?? "?",
    submitted_at: e.submitted_at,
    source: e.source,
    result: e.result,
    hidden: false,
  }));
  // closes_at is the midnight that ended the day; show the day itself.
  const day = new Date(new Date(round.closes_at).getTime() - 60_000).toISOString();

  return (
    <li>
      <details className="past-round">
        <summary className="list-row">
          <span className="archive-date">{formatDay(day)}</span>
          <span>
            <GameTag game={game} /> {game.puzzleLabel(round.puzzle_id)}
          </span>
          <span>
            {winners.length
              ? `★ ${winners.map((w) => names.get(w.user_id) ?? "?").join(", ")} · ${game.formatScore(winners[0].result)}`
              : "no winner"}
          </span>
        </summary>
        <div className="past-round-board">
          <Scoreboard game={game} rows={rows} closed canVoid={isOwner} onVoid={onVoid} />
        </div>
      </details>
    </li>
  );
}


/**
 * The games a crew plays, in its identity plate. The owner turns them on and
 * off right here and adds custom games (edited from their card under Today);
 * everyone else sees which ones count.
 */
function CrewGames({
  crew,
  games,
  allGames,
  isOwner,
  onGames,
  onAddCustom,
}: {
  crew: Crew;
  games: string[];
  allGames: GameAdapter<unknown>[];
  isOwner: boolean;
  onGames: (games: string[]) => void;
  /** Opens the form for a new custom game. Custom games are edited from their card under Today. */
  onAddCustom: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tracked = allGames.filter((g) => games.includes(g.id));

  async function toggle(game: GameAdapter<unknown>) {
    const on = !games.includes(game.id);
    if (!on && !confirm(`Stop playing ${game.name} in ${crew.name}? Past days and rankings stay.`)) return;
    setBusy(game.id);
    setError(null);
    try {
      await rpc("set_crew_game", { p_crew: crew.id, p_game: game.id, p_tracked: on });
      // A game you just added opens expanded, even if you'd collapsed it before.
      if (on) rememberCollapsed(crew.id, game.id, false);
      onGames(on ? [...games, game.id] : games.filter((g) => g !== game.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crew-games">
      <span className="crew-games-label">Games</span>
      {isOwner ? (
        <>
          <ul className="game-toggles">
            {allGames.map((g) => {
              const on = games.includes(g.id);
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    className="game-toggle"
                    style={gameStyle(g)}
                    aria-pressed={on}
                    disabled={busy !== null}
                    title={on ? `Stop playing ${g.name}` : `Play ${g.name} in this crew`}
                    onClick={() => toggle(g)}
                  >
                    <span aria-hidden>{on ? "✓" : "+"}</span> {g.name}
                  </button>
                </li>
              );
            })}
            <li>
              <button type="button" className="game-toggle add-custom" onClick={onAddCustom}>
                <span aria-hidden>+</span> Custom
              </button>
            </li>
          </ul>
          {error && <p className="error small">{error}</p>}
        </>
      ) : tracked.length ? (
        <ul className="game-toggles">
          {tracked.map((g) => (
            <li key={g.id}>
              <GameTag game={g} />
            </li>
          ))}
        </ul>
      ) : (
        <span className="muted small">None yet</span>
      )}
    </div>
  );
}

function ManageCrew({
  crew,
  members,
  onCrew,
  onRemoved,
  onDeleted,
}: {
  crew: Crew;
  members: Member[];
  onCrew: (crew: Crew) => void;
  onRemoved: () => void;
  /** The crew is gone: close the dialog before leaving the page. */
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = members.filter((m) => m.user_id !== crew.created_by);
  const timezone = crew.timezone ?? "UTC";
  // The times shown are refreshed whenever the list is opened.
  const [zonesAt, setZonesAt] = useState(() => Date.now());
  const zones = useMemo(() => zoneGroups(timezone, new Date(zonesAt)), [timezone, zonesAt]);
  const [name, setName] = useState(crew.name);
  const nameChanged = name.trim() !== "" && name.trim() !== crew.name;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const updateSettings = (settings: Record<string, unknown>) =>
    run("settings", async () => {
      onCrew(await rpc<Crew>("update_crew_settings", { p_crew: crew.id, ...settings }));
    });

  async function remove(m: Member) {
    const name = m.profiles.display_name;
    if (!confirm(`Remove ${name} from ${crew.name}? Their results for today are deleted, and they can't rejoin with the invite link.`)) return;
    await run(m.user_id, async () => {
      await rpc("remove_crew_member", { p_crew: crew.id, p_user: m.user_id });
      onRemoved();
    });
  }

  async function deleteCrew() {
    if (!confirm(`Delete ${crew.name} for everyone? All its results and rankings are deleted. This can't be undone.`)) return;
    await run("crew", async () => {
      await rpc("delete_crew", { p_crew: crew.id });
      // Have the extension drop this crew from its saved results.
      askExtension("sync");
      onDeleted();
      router.push("/");
    });
  }

  return (
    <>
      <h3>Name</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (nameChanged) updateSettings({ p_name: name.trim() });
        }}
      >
        <input
          className="input grow"
          aria-label="Crew name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-small" disabled={busy !== null || !nameChanged}>
          {busy === "settings" && nameChanged ? "Saving…" : "Rename"}
        </button>
      </form>

      <h3>Rules</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={crew.hide_until_submitted}
          disabled={busy !== null}
          onChange={(e) => updateSettings({ p_hide_until_submitted: e.target.checked })}
        />{" "}
        Hide scores until you submit (no spoilers)
      </label>
      <label className="field">
        <span>Time Zone</span>
        <select
          className="input"
          value={timezone}
          disabled={busy !== null}
          onChange={(e) => updateSettings({ p_timezone: e.target.value })}
          onFocus={() => setZonesAt(Date.now())}
          onMouseDown={() => setZonesAt(Date.now())}
        >
          {zones.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="muted small">The day ends at midnight in the selected time zone.</p>

      <h3>Members</h3>
      {others.length === 0 ? (
        <p className="muted small">No other members yet.</p>
      ) : (
        <ul className="manage-members">
          {others.map((m) => (
            <li key={m.user_id}>
              <span>{m.profiles.display_name}</span>
              <button className="link-btn danger" disabled={busy !== null} onClick={() => remove(m)}>
                {busy === m.user_id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row between wrap danger-zone">
        <button className="btn btn-small btn-danger" disabled={busy !== null} onClick={deleteCrew}>
          {busy === "crew" ? "Deleting…" : "Delete crew"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </>
  );
}
