"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { confirmByTyping, confirmDialog, confirmWithOption } from "@/components/ConfirmDialog";
import { CopyLink } from "@/components/CopyLink";
import { CustomGameForm } from "@/components/CustomGameForm";
import { GearIcon } from "@/components/GearIcon";
import { GameTag, gameStyle } from "@/components/GameTag";
import { Modal } from "@/components/Modal";
import { MemberStats } from "@/components/MemberStats";
import { ReorderGames } from "@/components/ReorderGames";
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
import { crewDayEnd, crewDeadline, crewPuzzle, localTimeZone } from "@/lib/rounds";
import { useClock24h } from "@/lib/clock";
import { inSavedOrder, saveGameOrder, savedGameOrder, syncGameOrder } from "@/lib/gameOrder";
import { crewStats } from "@/lib/stats";
import { errorMessage, rpc, supabase } from "@/lib/supabase";
import { dateIn, formatDay, formatTime, timeLeft } from "@/lib/time";
import { zoneGroups } from "@/lib/timezones";
import { isClosed, type BoardRow, type Crew, type EntrySource, type Round } from "@/lib/types";

const POLL_MS = 10_000;

const TABS = [
  { id: "today", label: "Today" },
  { id: "rankings", label: "Rankings" },
  { id: "archive", label: "Archive" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const isTab = (s: string): s is Tab => TABS.some((t) => t.id === s);

const PERIODS = [
  { id: "all", label: "All time" },
  { id: "year", label: "This year" },
  { id: "month", label: "This month" },
  { id: "week", label: "This week" },
] as const;
type Period = (typeof PERIODS)[number]["id"];

/** Days since the epoch for a calendar date, so dates can be compared and stepped. */
const dayNumber = ([y, m, d]: [number, number, number]) => Date.UTC(y, m - 1, d) / 86_400_000;

/** Whether a round's day falls in the period, on the crew's calendar (weeks start Monday). */
function inPeriod(round: Round, period: Period, zone: string, now: number): boolean {
  if (period === "all") return true;
  const [y, m, d] = dateIn(zone, roundDay(round));
  const today = dateIn(zone, new Date(now));
  if (period === "year") return y === today[0];
  if (period === "month") return y === today[0] && m === today[1];
  const day = dayNumber([y, m, d]);
  const todayNum = dayNumber(today);
  const sinceMonday = (new Date(todayNum * 86_400_000).getUTCDay() + 6) % 7;
  return day >= todayNum - sinceMonday && day <= todayNum;
}

type Person = { user_id: string; profiles: { display_name: string; is_guest: boolean } };
type Member = Person & { joined_at: string };
/** Someone asking to join a crew that needs the owner's approval (only the owner sees these). */
type JoinRequest = Person & { created_at: string };
type RoundWithEntries = Round & {
  entries: {
    id: string;
    user_id: string;
    result: unknown;
    source: EntrySource;
    submitted_at: string;
    profiles: { display_name: string; is_guest: boolean } | null;
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
    // A crew that needs approval files a request instead: you can't see it yet.
    const { data: visible } = await sb.from("crews").select("id").eq("id", crew.id).maybeSingle();
    if (!visible) return { pending: crew } as const;
  } else {
    const { data, error } = await sb.from("crews").select("*").eq("invite_code", code.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!data) throw new CrewGoneError();
    crew = data as Crew;
  }
  const [m, g, cg, r, jr, go] = await Promise.all([
    sb.from("crew_members").select("user_id, joined_at, profiles(display_name, is_guest)").eq("crew_id", crew.id).order("joined_at"),
    sb.from("crew_games").select("game").eq("crew_id", crew.id),
    sb.from("custom_games").select("*").eq("crew_id", crew.id).order("created_at"),
    sb
      .from("rounds")
      .select("*, entries(id, user_id, result, source, submitted_at, profiles(display_name, is_guest))")
      .eq("crew_id", crew.id)
      .order("closes_at", { ascending: false }),
    // Only the owner can see these (and nobody else has any: they're members).
    sb
      .from("crew_join_requests")
      .select("user_id, created_at, profiles(display_name, is_guest)")
      .eq("crew_id", crew.id)
      .eq("declined", false)
      .order("created_at"),
    // Your own order for the crew's games (nobody else's is readable).
    sb.from("game_orders").select("games").eq("crew_id", crew.id).maybeSingle(),
  ]);
  if (m.error || g.error || cg.error || r.error || jr.error) throw m.error ?? g.error ?? cg.error ?? r.error ?? jr.error;
  return {
    pending: null,
    requests: jr.data as unknown as JoinRequest[],
    crew,
    members: m.data as unknown as Member[],
    games: (g.data as { game: string }[]).map((x) => x.game),
    customGames: cg.data as CustomGame[],
    rounds: r.data as RoundWithEntries[],
    // Undefined when it couldn't be read: this browser's copy stays in use.
    gameOrder: go.error ? undefined : ((go.data?.games as string[] | undefined) ?? null),
  };
}

function CrewPage() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const extension = useExtension();
  const [crew, setCrew] = useState<Crew | null>(null);
  // Asked to join a crew that needs approval; waiting for the owner.
  const [pending, setPending] = useState<Crew | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [games, setGames] = useState<string[]>([]);
  // The crew's games as the page first loaded them: the Games box puts these
  // first. Toggling a game doesn't move it until the next page load.
  const [loadedGames, setLoadedGames] = useState<{ crewId: string; games: string[] } | null>(null);
  const [customGames, setCustomGames] = useState<CustomGame[]>([]);
  const [rounds, setRounds] = useState<RoundWithEntries[]>([]);
  const [showManage, setShowManage] = useState(false);
  // The custom game form: null when closed, "new" when adding one, or the game being edited.
  const [editing, setEditing] = useState<CustomGame | "new" | null>(null);
  const [rankingsGame, setRankingsGame] = useState<string | null>(null);
  const [rankingsPeriod, setRankingsPeriod] = useState<Period>("all");
  // Bumped to make today's boards refetch.
  const [boardsKey, setBoardsKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const tabsId = useId();
  // Which of today's cards you've collapsed or opened this visit. Every visit
  // starts with them all open.
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const setCardOpen = useCallback((gameId: string, open: boolean) => {
    setOpenCards((p) => (p[gameId] === open ? p : { ...p, [gameId]: open }));
  }, []);
  // Your own order for today's cards (set in the Reorder games modal): this
  // browser's copy until your account's has loaded, and what you've dragged
  // this visit over both.
  const userId = user?.id;
  const crewId = crew?.id;
  const orderKey = userId && crewId ? `${userId}:${crewId}` : "";
  const [dragged, setDragged] = useState<{ key: string; ids: string[] } | null>(null);
  // Your account's copy as last loaded (games null: none saved yet).
  const [accountOrder, setAccountOrder] = useState<{ crewId: string; games: string[] | null } | null>(null);
  const storedOrder = useMemo(() => (userId && crewId ? savedGameOrder(userId, crewId) : []), [userId, crewId]);
  const fromAccount = accountOrder && accountOrder.crewId === crewId ? accountOrder.games : null;
  const gameOrder = dragged?.key === orderKey ? dragged.ids : (fromAccount ?? storedOrder);
  useEffect(() => {
    if (userId && accountOrder) syncGameOrder(userId, accountOrder.crewId, accountOrder.games);
  }, [userId, accountOrder]);
  const [showReorder, setShowReorder] = useState(false);
  // Whose card is open (from their name in the crew box).
  const [viewing, setViewing] = useState<string | null>(null);
  // Whether you've submitted each of today's games, as their boards report it.
  const [played, setPlayed] = useState<Record<string, boolean>>({});
  const onPlayed = useCallback(
    (gameId: string, done: boolean) => setPlayed((p) => (p[gameId] === done ? p : { ...p, [gameId]: done })),
    [],
  );

  // The tab comes from the link (#rankings); a plain link always opens on Today.
  useEffect(() => {
    const onHash = () => {
      const hash = location.hash.slice(1);
      if (isTab(hash)) setTab(hash);
      else if (!hash) setTab("today");
    };
    onHash();
    // Back/Forward over our pushState entries fires popstate; an edited or followed #link fires hashchange.
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, [code]);

  function selectTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    // A history entry, so Back returns to the previous tab.
    history.pushState(null, "", next === "today" ? location.pathname + location.search : `#${next}`);
  }

  const load = useCallback(
    (join = false) =>
      fetchCrew(code, join).then(
        (d) => {
          if (d.pending) return setPending(d.pending);
          setPending(null);
          setCrew(d.crew);
          setRequests(d.requests);
          setMembers(d.members);
          setGames(d.games);
          setLoadedGames((prev) => (prev?.crewId === d.crew.id ? prev : { crewId: d.crew.id, games: d.games }));
          setCustomGames(d.customGames);
          setRounds(d.rounds);
          if (d.gameOrder !== undefined) setAccountOrder({ crewId: d.crew.id, games: d.gameOrder });
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
      if (document.visibilityState === "visible") load(pending !== null);
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, pending]);

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
  // The Games box: games the crew played when the page loaded first, then the
  // rest (each group in the order above).
  const boxGames = useMemo(() => {
    const on = new Set(loadedGames?.games ?? []);
    return [...allGames.filter((g) => on.has(g.id)), ...allGames.filter((g) => !on.has(g.id))];
  }, [allGames, loadedGames]);
  // The archive lists each day's games in the same order as the Games box.
  const archiveOrder = useMemo(() => boxGames.map((g) => g.id), [boxGames]);
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

  // Guests, current and past: marked "(guest)" in the rankings and the archive.
  const guests = useMemo(() => {
    const set = new Set<string>();
    for (const r of rounds) for (const e of r.entries) if (e.profiles?.is_guest) set.add(e.user_id);
    for (const m of members) if (m.profiles.is_guest) set.add(m.user_id);
    return set;
  }, [rounds, members]);

  // Rounds nobody finished aren't worth showing.
  const finished = useMemo(() => rounds.filter((r) => isClosed(r, now) && r.entries.length > 0), [rounds, now]);

  // Games anyone has played in this crew, finished or today: the choices in
  // Rankings, in the same order as your cards on Today (games not
  // in it go last).
  const rankedGames = useMemo(
    () =>
      inSavedOrder(
        allGames.filter((g) => rounds.some((r) => r.game === g.id && r.entries.length > 0)),
        (g) => g.id,
        gameOrder,
      ),
    [rounds, allGames, gameOrder],
  );

  // Rankings count only days that end after the owner last reset them (the archive keeps them all).
  const resetAt = crew?.rankings_reset_at ?? null;
  const finishedSinceReset = useMemo(
    () => (resetAt ? finished.filter((r) => Date.parse(r.closes_at) > Date.parse(resetAt)) : finished),
    [finished, resetAt],
  );

  const ranked = useMemo(() => {
    const game = rankedGames.find((g) => g.id === rankingsGame) ?? rankedGames[0];
    if (!game || !crew) return null;
    const zone = crew.timezone ?? "UTC";
    // Finished days only: today's round is on the Today tab.
    const played = finishedSinceReset.filter((r) => r.game === game.id && inPeriod(r, rankingsPeriod, zone, now));
    // Current members only: anyone who left or was removed (including guests
    // removed for being inactive) drops out of the rankings, though their
    // finished days stay in the archive. Matches the extension's rankings.
    const ids = members.map((m) => m.user_id);
    return { game, count: played.length, ...crewStats(game, played, ids, { byWinRate: crew.rank_by_win_rate }) };
  }, [rankedGames, rankingsGame, rankingsPeriod, crew, finishedSinceReset, members, now]);

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
  if (pending && !crew) {
    return (
      <div className="card stack">
        <h1>Request sent</h1>
        <p>
          You&apos;ve asked to join <strong>{pending.name}</strong>. Please wait for the owner&apos;s approval.
        </p>
        <Link href="/" className="btn back-home-btn">
          Back to your crews
        </Link>
      </div>
    );
  }
  if (error && !crew) return <p className="error">{error}</p>;
  if (!crew) return <Loading />;

  const isOwner = crew.created_by === user?.id;
  // The open member card, if any (they may have just left).
  const viewedRow = members.find((m) => m.user_id === viewing);
  const viewedMember = viewedRow
    ? {
        userId: viewedRow.user_id,
        name: viewedRow.profiles.display_name,
        isGuest: viewedRow.profiles.is_guest,
        isOwner: viewedRow.user_id === crew.created_by,
        joinedAt: viewedRow.joined_at,
      }
    : null;
  // Everyone the rankings include: current members.
  const rankedIds = members.map((m) => m.user_id);
  const tracked = inSavedOrder(
    allGames.filter((g) => games.includes(g.id)),
    (g) => g.id,
    gameOrder,
  );
  const isOpen = (gameId: string) => openCards[gameId] ?? true;
  const anyCollapsed = tracked.some((g) => !isOpen(g.id));
  const toPlay = tracked.filter((g) => played[g.id] === false).length;
  // Custom games with scores in them have their scoring locked.
  const playedGames = new Set(rounds.filter((rd) => rd.entries.length > 0).map((rd) => rd.game));

  function reorder(ids: string[]) {
    if (!userId || !crewId) return;
    setDragged({ key: orderKey, ids });
    saveGameOrder(userId, crewId, ids);
  }

  async function voidEntry(name: string, entryId: string) {
    if (!(await confirmDialog(`Void ${name}'s entry? They'll have to replay the game to submit a new score. This cannot be undone.`)))
      return;
    try {
      await rpc("void_entry", { p_entry: entryId });
      setBoardsKey((k) => k + 1);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function resetRankings() {
    if (
      !crew ||
      !(await confirmDialog(
        `Reset ALL rankings for ${crew.name}? This CANNOT be undone.`,
      ))
    )
      return;
    try {
      setCrew(await rpc<Crew>("reset_rankings", { p_crew: crew.id }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function leave() {
    if (!crew || !(await confirmDialog(`Leave ${crew.name}? Your results for today are removed. You can rejoin with the invite link.`)))
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
          <span>{members.length}/10 members</span>
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
                  <GearIcon />
                </button>
              ) : (
                <button className="btn btn-small btn-danger" onClick={leave}>
                  Leave
                </button>
              )}
            </div>
          </div>
          <ul className="member-chips">
            {/* The owner first (after a transfer, the new one), then in the order they joined. */}
            {[...members]
              .sort((a, b) => Number(b.user_id === crew.created_by) - Number(a.user_id === crew.created_by))
              .map((m) => (
                <li key={m.user_id} className={m.user_id === user?.id ? "me" : undefined}>
                  {/* Opens their card: when they joined, and their stats. */}
                  <button
                    type="button"
                    className="member-chip"
                    aria-haspopup="dialog"
                    title={`${m.profiles.display_name}'s stats`}
                    onClick={() => setViewing(m.user_id)}
                  >
                    {m.user_id === crew.created_by && <OwnerCrown />}
                    {m.profiles.display_name}
                    {m.profiles.is_guest && <span className="guest-tag"> (guest)</span>}
                  </button>
                </li>
              ))}
          </ul>
          <CrewGames
            crew={crew}
            games={games}
            allGames={boxGames}
            isOwner={isOwner}
            onGames={(next) => {
              // A game you just turned on opens expanded, even if you'd collapsed it before.
              for (const g of next) if (!games.includes(g)) setCardOpen(g, true);
              // A game turned off loses its day in progress (the server deletes it too).
              const removed = games.filter((g) => !next.includes(g));
              if (removed.length) {
                const at = Date.now();
                setRounds((list) => list.filter((r) => !removed.includes(r.game) || isClosed(r, at)));
              }
              setGames(next);
            }}
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
                    setCardOpen(customGameId(saved.id), true);
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
              requests={requests}
              onCrew={setCrew}
              onRemoved={() => {
                setBoardsKey((k) => k + 1);
                load();
              }}
              onDeleted={() => setShowManage(false)}
              onTransferred={(next) => {
                // Not the owner any more: the settings aren't yours to change.
                setShowManage(false);
                setCrew(next);
                load();
              }}
            />
          </Modal>
        )}
      </section>

      <MemberStats
        member={viewedMember}
        games={rankedGames}
        rounds={finishedSinceReset}
        rankedIds={rankedIds}
        byWinRate={crew.rank_by_win_rate}
        onClose={() => setViewing(null)}
      />

      {isOwner && requests.length > 0 && (
        <p className="card small join-requests-note" role="status">
          {requests.length === 1
            ? `${requests[0].profiles.display_name} wants to join.`
            : `${requests.length} people want to join.`}{" "}
          <button type="button" className="link-btn" onClick={() => setShowManage(true)}>
            Review in Manage crew
          </button>
        </p>
      )}


      <div className="crew-tabs">
        <div className="crew-tabs-list" role="tablist" aria-label="Crew sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabsId}-${t.id}-tab`}
              aria-selected={tab === t.id}
              aria-controls={`${tabsId}-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="crew-tab"
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab);
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = TABS[(i + step + TABS.length) % TABS.length].id;
                selectTab(next);
                document.getElementById(`${tabsId}-${next}-tab`)?.focus();
              }}
            >
              {t.label}
              {t.id === "today" && toPlay > 0 && (
                <span className="crew-tab-badge" title={`${toPlay} left to play today`}>
                  <span className="crew-tab-badge-num">{toPlay}</span>
                  <span className="sr-only"> left to play</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <button className="btn btn-small" disabled={refreshing} onClick={refreshNow}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* One wrapper, so the page's entrance animation runs once and not on every tab switch. */}
      <div className="crew-panels">
        <section
          className="stack today-panel"
          role="tabpanel"
          id={`${tabsId}-today`}
          aria-labelledby={`${tabsId}-today-tab`}
          hidden={tab !== "today"}
        >
          <h2 className="sr-only">Today</h2>
          <DayEndedNotice
            crew={crew}
            rounds={finished}
            findGame={findGame}
            names={names}
            now={now}
            onRankings={() => selectTab("rankings")}
          />
          {/* Every game's day ends together, at the crew's midnight (games on another clock say so on their card). */}
          {tracked.length > 0 && (
            <div className="row between today-head">
              <span className="time-left">
                <span className="live-dot" aria-hidden>
                  ●
                </span>
                {timeLeft(crewDayEnd(crew, new Date(now)).toISOString(), now)} left
              </span>
              <div className="row today-head-actions">
                {tracked.length > 1 && (
                  <button type="button" className="link-btn" aria-haspopup="dialog" onClick={() => setShowReorder(true)}>
                    reorder
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => tracked.forEach((g) => setCardOpen(g.id, anyCollapsed))}
                >
                  {anyCollapsed ? "expand all" : "collapse all"}
                </button>
              </div>
              <ReorderGames
                open={showReorder}
                games={tracked}
                onSave={reorder}
                onClose={() => setShowReorder(false)}
              />
            </div>
          )}
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
                memberCount={members.length}
                extension={extension.state}
                refreshKey={boardsKey}
                onEdit={isOwner && customOf(game) ? () => setEditing(customOf(game)) : undefined}
                onVoid={(row) => voidEntry(row.display_name, row.entry_id)}
                onPlayed={onPlayed}
                open={isOpen(game.id)}
                onOpen={(open) => setCardOpen(game.id, open)}
              />
            ))
          )}
        </section>

        <section
          className="stack"
          role="tabpanel"
          id={`${tabsId}-rankings`}
          aria-labelledby={`${tabsId}-rankings-tab`}
          hidden={tab !== "rankings"}
        >
          {ranked ? (
            <>
              <h2 className="sr-only">Rankings</h2>
              <p className="rankings-head">
                <span>Rankings for</span>
                <select
                  className="input rankings-select"
                  aria-label="Game"
                  value={ranked.game.id}
                  onChange={(e) => setRankingsGame(e.target.value)}
                >
                  {rankedGames.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
                <span>from</span>
                <select
                  className="input rankings-select"
                  aria-label="Period"
                  value={rankingsPeriod}
                  onChange={(e) => setRankingsPeriod(e.target.value as Period)}
                >
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </p>
              {ranked.count > 0 ? (
                <Rankings game={ranked.game} players={ranked.players} names={names} guests={guests} />
              ) : (
                <p className="muted">
                  {`No finished days for ${ranked.game.name} ${PERIODS.find((p) => p.id === rankingsPeriod)!.label.toLowerCase()}.`}
                </p>
              )}
            </>
          ) : (
            <p className="muted">Rankings show up once someone has played.</p>
          )}
          {isOwner && ranked && ranked.count > 0 && (
            <p>
              <button className="btn btn-small btn-danger" onClick={resetRankings}>
                Reset rankings
              </button>
            </p>
          )}
        </section>

        <section
          className="stack"
          role="tabpanel"
          id={`${tabsId}-archive`}
          aria-labelledby={`${tabsId}-archive-tab`}
          hidden={tab !== "archive"}
        >
          <h2 className="sr-only">Archive</h2>
          <p className="muted">Results from previous days will show up here.</p>
          {finished.length > 0 && (
            <Archive
              rounds={finished}
              order={archiveOrder}
              findGame={findGame}
              names={names}
              isOwner={isOwner}
              onVoid={(row) => voidEntry(row.display_name, row.entry_id)}
            />
          )}
        </section>
      </div>
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
  memberCount,
  extension,
  refreshKey,
  onEdit,
  onVoid,
  onPlayed,
  open,
  onOpen,
}: {
  /** Expanded or collapsed: kept by the page, so it can open or close them all. */
  open: boolean;
  onOpen: (open: boolean) => void;
  crew: Crew;
  game: GameAdapter<unknown>;
  now: number;
  isOwner: boolean;
  /** People in the crew: "2/5 played". */
  memberCount: number;
  extension: ExtensionState;
  refreshKey: number;
  /** Set for the owner on a custom game: opens its settings. */
  onEdit?: () => void;
  onVoid: (row: BoardRow) => void;
  /** Reports whether you've submitted, once the board has loaded. */
  onPlayed: (gameId: string, played: boolean) => void;
}) {
  const { user } = useAuth();
  const puzzleId = crewPuzzle(game, crew, new Date(now));
  const ends = crewDeadline(game, crew, new Date(now));
  const deadline = ends.toISOString();
  // Noted on the card only when this game's day doesn't end with the crew's
  // (Krillion on New York time, Poople at 08:00 UTC).
  const ownClock = ends.getTime() !== crewDayEnd(crew, new Date(now)).getTime();
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const toggle = () => onOpen(!open);

  const loadBoard = useCallback(
    () =>
      rpc<BoardRow[]>("get_round_board", { p_crew: crew.id, p_game: game.id, p_puzzle: puzzleId }).then(
        (rows) => {
          setBoard(rows);
          setLoaded(true);
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
  useEffect(() => {
    if (loaded) onPlayed(game.id, submitted);
  }, [loaded, submitted, game.id, onPlayed]);

  return (
    <article
      className={`game-card ${open ? "" : "collapsed"} ${submitted ? "" : "unplayed"}`}
      style={gameStyle(game)}
      data-game-card={game.id}
    >
      {/* The whole bar toggles too; the name stays the keyboard-reachable button. */}
      <header
        className="game-card-bar"
        onClick={(e) => {
          if (!(e.target as Element).closest("button, a, input, select")) toggle();
        }}
      >
        <h3 className="today-title">
          <button type="button" className="game-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <span className="game-card-chevron" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
            {game.name} <span className="game-card-puzzle">{game.puzzleLabel(puzzleId)}</span>
          </button>
        </h3>
        <div className="game-card-right">
          <span className="game-card-summary">
            {submitted ? "✓ Completed" : "Your turn"} · {board.length}/{memberCount} played
          </span>
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
        {ownClock && <OwnClockNote game={game} deadline={deadline} now={now} />}
        <Scoreboard
          game={game}
          rows={board}
          closed={false}
          canVoid={isOwner}
          onVoid={onVoid}
        />
        {error && <p className="error small">{error}</p>}
      </div>
    </article>
  );
}

/**
 * On a game whose day doesn't end with the crew's (Poople, Krillion): when
 * this round closes instead, and why. Dismissing it lasts until the page reloads.
 */
function OwnClockNote({ game, deadline, now }: { game: GameAdapter<unknown>; deadline: string; now: number }) {
  const clock24h = useClock24h();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="own-clock-note" role="note">
      <span>
        <strong>⚠ NOTE:</strong> {game.name} switches to a new puzzle at <strong>{formatTime(deadline, clock24h)}</strong> your time, NOT at
        midnight. You have{" "}
        <span className="time-left">
          {timeLeft(deadline, now)}
        </span>{" "}
        to complete it.
      </span>
      <button type="button" className="own-clock-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

/** Dismissing the "day has ended" notice, per crew and day, in this browser. */
const endedKey = (crewId: string, day: string) => `scrim-day-ended:${crewId}:${day}`;

function wasDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/**
 * Once the crew's day rolls over: yesterday is over, here's who won each game,
 * and a nudge to the rankings. Shown on the Today tab until dismissed.
 */
function DayEndedNotice({
  crew,
  rounds,
  findGame,
  names,
  now,
  onRankings,
}: {
  crew: Crew;
  /** Finished rounds with entries. */
  rounds: RoundWithEntries[];
  findGame: (id: string) => GameAdapter<unknown>;
  names: Map<string, string>;
  now: number;
  onRankings: () => void;
}) {
  const zone = crew.timezone ?? "UTC";
  const yesterday = dayNumber(dateIn(zone, new Date(now))) - 1;
  const dayKey = String(yesterday);
  const key = endedKey(crew.id, dayKey);
  // Only rendered once the crew has loaded in the browser, so storage is there to read.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const results = useMemo(
    () =>
      rounds
        .filter((r) => dayNumber(dateIn(zone, roundDay(r))) === yesterday)
        .map((r) => {
          const game = findGame(r.game);
          const winners = rankEntries(game, r.entries).filter((e) => e.winner);
          return { id: r.id, game, winners: winners.map((w) => names.get(w.user_id) ?? "?") };
        }),
    [rounds, zone, yesterday, findGame, names],
  );

  if (results.length === 0 || dismissed === key || wasDismissed(key)) return null;

  function dismiss() {
    setDismissed(key);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: it comes back next visit.
    }
  }

  return (
    <div className="card day-ended" role="status">
      <div className="row between day-ended-head">
        <strong>Yesterday&apos;s games have ended!</strong>
        <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      <ul className="day-ended-results">
        {results.map(({ id, game, winners }) => (
          <li key={id}>
            <GameTag game={game} />{" "}
            {winners.length === 0
              ? "No winner"
              : `★ ${joinNames(winners)} ${winners.length > 1 ? "win" : "wins"}`}
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn" onClick={onRankings}>
        View rankings →
      </button>
    </div>
  );
}


/** closes_at is the midnight that ended the day; this is a moment in the day itself. */
const roundDay = (round: Round) => new Date(new Date(round.closes_at).getTime() - 60_000);

/** Past rounds on a month calendar: a day with results opens its games in a modal. */
function Archive({
  rounds,
  order,
  findGame,
  names,
  isOwner,
  onVoid,
}: {
  rounds: RoundWithEntries[];
  /** Game ids in the order the crew's Games box lists them; each day's games follow it. */
  order: string[];
  findGame: (id: string) => GameAdapter<unknown>;
  names: Map<string, string>;
  isOwner: boolean;
  onVoid: (row: BoardRow) => void;
}) {
  // Finished rounds by day ("2026-11-23", the viewer's calendar), each day's games in order.
  const days = useMemo(() => {
    const byDay = new Map<string, RoundWithEntries[]>();
    for (const r of rounds) {
      const key = dayKey(roundDay(r));
      byDay.set(key, [...(byDay.get(key) ?? []), r]);
    }
    for (const [key, list] of byDay) byDay.set(key, inSavedOrder(list, (r) => r.game, order));
    return byDay;
  }, [rounds, order]);

  // Months that have results, newest last: the calendar moves between them.
  const months = useMemo(() => [...new Set([...days.keys()].map((k) => k.slice(0, 7)))].sort(), [days]);
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month && months.includes(month) ? month : months[months.length - 1];
  const at = months.indexOf(shownMonth);
  const [openDay, setOpenDay] = useState<string | null>(null);
  if (!shownMonth) return null;

  const [y, m] = shownMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const length = new Date(y, m, 0).getDate();
  // Blank cells before the 1st, so it lands on its weekday (weeks start on Sunday).
  const cells: (string | null)[] = [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length }, (_, i) => dayKey(new Date(y, m - 1, i + 1))),
  ];
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 10, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }),
  );
  const todayKey = dayKey(new Date());
  const dayRounds = openDay ? (days.get(openDay) ?? []) : [];

  return (
    <div className="archive-cal">
      <nav className="archive-cal-head" aria-label="Archive months">
        <button
          type="button"
          className="btn btn-small"
          disabled={at <= 0}
          aria-label="Earlier month"
          onClick={() => setMonth(months[at - 1])}
        >
          ←
        </button>
        <span className="archive-cal-month">
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          className="btn btn-small"
          disabled={at >= months.length - 1}
          aria-label="Later month"
          onClick={() => setMonth(months[at + 1])}
        >
          →
        </button>
      </nav>
      <div className="archive-cal-grid">
        {weekdays.map((w, i) => (
          <span key={`w${i}`} className="archive-cal-weekday" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`b${i}`} />;
          const list = days.get(key);
          const n = Number(key.slice(8));
          if (!list) {
            return (
              <span key={key} className={`archive-cal-day ${key === todayKey ? "today" : ""}`}>
                {n}
              </span>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className="archive-cal-day has-results"
              aria-label={`${formatDay(fromDayKey(key).toISOString())}: ${list.map((r) => findGame(r.game).name).join(", ")}`}
              onClick={() => setOpenDay(key)}
            >
              <span>{n}</span>
              <span className="archive-cal-dots" aria-hidden>
                {list.map((r) => (
                  <span key={r.id} className="archive-cal-dot" style={gameStyle(findGame(r.game))} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <Modal
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={openDay ? formatDay(fromDayKey(openDay).toISOString()) : ""}
        size="large"
      >
        <ul className="list list-archive archive-day-rounds">
          {dayRounds.map((r) => (
            <PastRound
              key={r.id}
              game={findGame(r.game)}
              round={r}
              names={names}
              isOwner={isOwner}
              onVoid={onVoid}
            />
          ))}
        </ul>
      </Modal>
    </div>
  );
}

/** "2026-11-23" for a date on the viewer's calendar. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
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
    is_guest: e.profiles?.is_guest ?? false,
    submitted_at: e.submitted_at,
    source: e.source,
    result: e.result,
    hidden: false,
  }));
  return (
    <li>
      <details className="past-round">
        <summary className="list-row">
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
    if (
      !on &&
      !(await confirmDialog(
        `Stop playing ${game.name} in ${crew.name}? Today's ${game.name} scores are deleted and won't come back if you add it again. Past days and rankings stay.`,
      ))
    )
      return;
    setBusy(game.id);
    setError(null);
    try {
      await rpc("set_crew_game", { p_crew: crew.id, p_game: game.id, p_tracked: on });
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

/**
 * Removes a member, after asking (with the option to delete their past
 * results too). Used by Manage crew and by a member's card. Resolves true if
 * they were removed, false if the owner cancelled; throws if it failed.
 */
async function removeMember(crew: Crew, m: Person): Promise<boolean> {
  const name = m.profiles.display_name;
  const wipe = await confirmWithOption(
    `Remove ${name} from ${crew.name}? Their results for today are deleted. They can rejoin with the invite link.`,
    `Delete ${name}'s past results and stats in this crew`,
  );
  if (wipe === null) return false;
  await rpc("remove_crew_member", { p_crew: crew.id, p_user: m.user_id, p_wipe: wipe });
  return true;
}

function ManageCrew({
  crew,
  members,
  requests,
  onCrew,
  onRemoved,
  onDeleted,
  onTransferred,
}: {
  crew: Crew;
  members: Member[];
  requests: JoinRequest[];
  onCrew: (crew: Crew) => void;
  /** Members changed (removed, or let in): reload. */
  onRemoved: () => void;
  /** The crew is gone: close the dialog before leaving the page. */
  onDeleted: () => void;
  /** Someone else owns it now: close the dialog and reload. */
  onTransferred: (crew: Crew) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = members.filter((m) => m.user_id !== crew.created_by);
  // Who it can go to: other members with a Google account (not guests).
  const heirs = others.filter((m) => !m.profiles.is_guest);
  const [heir, setHeir] = useState("");
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

  // Let someone in, or turn them down (they're told when they next open the link).
  async function answer(r: JoinRequest, approve: boolean) {
    await run(`${approve ? "approve" : "decline"}:${r.user_id}`, async () => {
      await rpc("answer_join_request", { p_crew: crew.id, p_user: r.user_id, p_approve: approve });
      onRemoved();
    });
  }

  async function remove(m: Member) {
    await run(m.user_id, async () => {
      if (await removeMember(crew, m)) onRemoved();
    });
  }

  // Hand the crew to another member, after they type that member's name.
  async function transfer() {
    const to = heirs.find((m) => m.user_id === heir);
    if (!to) return;
    const name = to.profiles.display_name;
    if (
      !(await confirmByTyping(
        `Make ${name} the owner of ${crew.name}? They'll be able to change its settings and remove anyone, including you. You'll stay in the crew as a regular member. Only ${name} can give it back.`,
        name,
      ))
    )
      return;
    await run("transfer", async () => {
      onTransferred(await rpc<Crew>("transfer_crew", { p_crew: crew.id, p_user: to.user_id }));
    });
  }

  async function deleteCrew() {
    if (
      !(await confirmByTyping(
        `Delete ${crew.name} for everyone? All its results and rankings are deleted. This can't be undone.`,
        crew.name,
      ))
    )
      return;
    await run("crew", async () => {
      await rpc("delete_crew", { p_crew: crew.id });
      // Have the extension drop this crew from its saved results.
      askExtension("sync");
      onDeleted();
      router.push("/");
    });
  }

  return (
    <div className="stack manage-body">
      <section className="manage-card">
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
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="btn btn-small" disabled={busy !== null || !nameChanged}>
            {busy === "settings" && nameChanged ? "Saving…" : "Rename"}
          </button>
        </form>
      </section>

      <section className="manage-card">
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
        <label className="check">
          <input
            type="checkbox"
            checked={crew.allow_guests}
            disabled={busy !== null}
            onChange={(e) => updateSettings({ p_allow_guests: e.target.checked })}
          />{" "}
          Allow guests to join crew
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={crew.require_approval}
            disabled={busy !== null}
            onChange={(e) => updateSettings({ p_require_approval: e.target.checked })}
          />{" "}
          Approve new members before they join
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={crew.rank_by_win_rate}
            disabled={busy !== null}
            onChange={(e) => updateSettings({ p_rank_by_win_rate: e.target.checked })}
          />{" "}
          Omit skipped days from rankings stats
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
        <p className="muted small">The day ends at midnight in this time zone.</p>
      </section>

      {requests.length > 0 && (
        <section className="manage-card">
          <h3>Join requests</h3>
          <ul className="manage-members">
            {requests.map((r) => (
              <li key={r.user_id}>
                <span>
                  {r.profiles.display_name}
                  {r.profiles.is_guest && <span className="guest-tag"> (guest)</span>}
                </span>
                <span className="row">
                  <button className="link-btn" disabled={busy !== null} onClick={() => answer(r, true)}>
                    {busy === `approve:${r.user_id}` ? "Approving…" : "Approve"}
                  </button>
                  <button className="link-btn danger" disabled={busy !== null} onClick={() => answer(r, false)}>
                    {busy === `decline:${r.user_id}` ? "Declining…" : "Decline"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="manage-card">
        <h3>Members (10 max)</h3>
        <ul className="manage-members">
          {members.map((m) =>
            m.user_id === crew.created_by ? (
              // The owner (you): listed, but can't be removed.
              <li key={m.user_id}>
                <span>
                  <OwnerCrown />
                  {m.profiles.display_name} <span className="muted">(you)</span>
                </span>
              </li>
            ) : (
              <li key={m.user_id}>
                <span>
                  {m.profiles.display_name}
                  {m.profiles.is_guest && <span className="guest-tag"> (guest)</span>}
                </span>
                <button className="link-btn danger" disabled={busy !== null} onClick={() => remove(m)}>
                  {busy === m.user_id ? "Removing…" : "Remove"}
                </button>
              </li>
            ),
          )}
          {others.length === 0 && <li className="muted small">No other members yet.</li>}
        </ul>
      </section>

      <section className="manage-card">
        <h3>Transfer ownership (non-guests only)</h3>
        {heirs.length === 0 ? (
          <p className="muted small">
            Nobody to hand it to yet. The new owner has to be in the crew, signed in with Google (not a guest).
          </p>
        ) : (
          <>
            <div className="row">
              <select
                className="input grow"
                aria-label="New owner"
                value={heir}
                disabled={busy !== null}
                onChange={(e) => setHeir(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {heirs.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profiles.display_name}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" disabled={busy !== null || !heir} onClick={transfer}>
                {busy === "transfer" ? "Transferring…" : "Transfer"}
              </button>
            </div>
          </>
        )}
      </section>

      <div className="row between wrap danger-zone">
        <button className="btn btn-small btn-danger" disabled={busy !== null} onClick={deleteCrew}>
          {busy === "crew" ? "Deleting…" : "Delete crew"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** A filled crown before the owner's name. Drawn in the text colour (gold, via CSS). */
function OwnerCrown() {
  return (
    // The tooltip sits on a wrapper: an SVG <title> would count as the chip's text.
    <span title="Crew owner">
      <svg className="owner-crown" viewBox="0 0 24 20" role="img" aria-label="Owner">
        <path d="M2 5l5.5 5L12 2l4.5 8L22 5l-2 10H4z" />
        <rect x="4" y="16.5" width="16" height="3" />
      </svg>
    </span>
  );
}
