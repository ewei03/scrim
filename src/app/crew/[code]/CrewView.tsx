"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { confirmByTyping, confirmDialog, confirmWithOption } from "@/components/ConfirmDialog";
import { CopyLink } from "@/components/CopyLink";
import { CustomGameForm } from "@/components/CustomGameForm";
import { ExternalArrow } from "@/components/ExternalArrow";
import { GearIcon } from "@/components/GearIcon";
import { GameTag, gameStyle } from "@/components/GameTag";
import { Modal } from "@/components/Modal";
import { ModeSwitch } from "@/components/ModeSwitch";
import { MemberStats } from "@/components/MemberStats";
import { ReorderGames } from "@/components/ReorderGames";
import { Rankings } from "@/components/Rankings";
import { Loading, RequireAuth } from "@/components/RequireAuth";
import { Scoreboard } from "@/components/Scoreboard";
import { SubmitPanel } from "@/components/SubmitPanel";
import { rankEntries } from "@/games/ranking";
import { customAdapter, customGameId, customOf, isCustomGameId, type CustomGame } from "@/games/custom";
import { MODE_GROUPS, groupItems, groupName, groupOf, mainId, modeLabel, saveMode, savedModes } from "@/games/modes";
import { gameList, getGame } from "@/games/registry";
import type { GameAdapter } from "@/games/types";
import { useAuth } from "@/lib/auth";
import { askExtension, useExtension, type ExtensionState } from "@/lib/extension";
import { crewDayEnd, crewDeadline, crewPuzzle, localTimeZone, roundZone } from "@/lib/rounds";
import { useClock24h } from "@/lib/clock";
import {
  inSavedOrder,
  saveGameOrder,
  savedGameOrder,
  saveUnplayedFirst,
  savedUnplayedFirst,
  syncGameOrder,
  unplayedFirst,
} from "@/lib/gameOrder";
import { saveOpenCards, savedOpenCards } from "@/lib/cardState";
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
/** A guest the cleanup took out of the crew for being inactive (0037). */
type Removal = { id: string; display_name: string; removed_at: string };
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
  const [m, g, cg, r, jr, go, rm] = await Promise.all([
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
    // Guests removed for inactivity lately (the server keeps a week of them).
    sb.from("crew_removals").select("id, display_name, removed_at").eq("crew_id", crew.id).order("removed_at"),
  ]);
  if (m.error || g.error || cg.error || r.error || jr.error) throw m.error ?? g.error ?? cg.error ?? r.error ?? jr.error;
  return {
    pending: null,
    requests: jr.data as unknown as JoinRequest[],
    // Empty if it couldn't be read: only a notice.
    removals: rm.error ? [] : (rm.data as Removal[]),
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
  const [removals, setRemovals] = useState<Removal[]>([]);
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
  // Which of today's cards you've collapsed or expanded, kept in this browser
  // so they stay that way next visit. Games with nothing saved (like one just
  // added) are expanded.
  const [openCards, setOpenCards] = useState<{ key: string; cards: Record<string, boolean> } | null>(null);
  const cardsNow = useMemo(
    () => (openCards?.key === orderKey ? openCards.cards : userId && crewId ? savedOpenCards(userId, crewId) : {}),
    [openCards, orderKey, userId, crewId],
  );
  const setCardOpen = useCallback(
    (gameId: string, open: boolean) => {
      if (!userId || !crewId) return;
      setOpenCards((p) => {
        const cards = p?.key === orderKey ? p.cards : savedOpenCards(userId, crewId);
        if (cards[gameId] === open && p?.key === orderKey) return p;
        const next = { ...cards, [gameId]: open };
        saveOpenCards(userId, crewId, next);
        return { key: orderKey, cards: next };
      });
    },
    [userId, crewId, orderKey],
  );
  const [showReorder, setShowReorder] = useState(false);
  // Which mode you're looking at for games that have them (Costcodle's
  // Checkout or Classic, the Mini's Easy or Hard), kept in this browser. The
  // same choice on the card, in Rankings and in the archive.
  const [modes, setModes] = useState<Record<string, string>>(() => savedModes());
  const pickMode = useCallback((group: string, mode: string) => {
    setModes((m) => ({ ...m, [group]: mode }));
    saveMode(group, mode);
  }, []);
  // The mode each Today card shows this visit (by its main mode's id). It
  // starts on the one you've still to play (the first, if both), settled once
  // whether you've played each is known; switching it picks it from then on.
  const [cardModes, setCardModes] = useState<Record<string, string>>({});
  // Whether games you've still to play go on top (set in the same modal).
  const [toPlayFirst, setToPlayFirst] = useState<{ key: string; on: boolean } | null>(null);
  const toPlayFirstNow =
    toPlayFirst?.key === orderKey ? toPlayFirst.on : userId && crewId ? savedUnplayedFirst(userId, crewId) : false;
  // Whose card is open (from their name in the crew box).
  const [viewing, setViewing] = useState<string | null>(null);
  // Whether you've submitted each of today's games, as their boards report it.
  const [played, setPlayed] = useState<Record<string, boolean>>({});
  // The last board seen for each mode of a game with modes ("game:puzzle"),
  // so switching a card's mode shows it straight away rather than an empty one.
  const [modeBoards, setModeBoards] = useState<Record<string, BoardRow[]>>({});
  const keepBoard = useCallback(
    (key: string, rows: BoardRow[]) => setModeBoards((b) => (b[key] === rows ? b : { ...b, [key]: rows })),
    [],
  );
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
          setRemovals(d.removals);
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
  // rest, each group in alphabetical order. A game with modes is listed once,
  // as its main mode.
  const boxGames = useMemo(() => {
    const on = new Set((loadedGames?.games ?? []).map(mainId));
    const name = (g: GameAdapter<unknown>) => groupName(g.id, g.name);
    const sorted = allGames
      .filter((g) => mainId(g.id) === g.id)
      .sort((a, b) => name(a).localeCompare(name(b), "en", { sensitivity: "base" }));
    return [...sorted.filter((g) => on.has(g.id)), ...sorted.filter((g) => !on.has(g.id))];
  }, [allGames, loadedGames]);
  // The archive lists each day's games in the same order as the Games box.
  const archiveOrder = useMemo(() => boxGames.map((g) => g.id), [boxGames]);
  const findGame = useCallback((id: string) => allGames.find((g) => g.id === id) ?? getGame(id), [allGames]);

  // A card shows one of a game's modes; whether you've played the others is
  // checked here (as often as the boards), so a game with any mode still to
  // play stays with the unplayed ones whichever mode is on show.
  /** The mode a card shows, of the crew's modes `ids` for the game `group` (in the game's order). */
  const cardShows = useCallback(
    (group: string, ids: string[]) => {
      const pick = cardModes[group] ?? modes[group];
      return ids.find((id) => id === pick) ?? ids[0];
    },
    [cardModes, modes],
  );
  const otherModes = useMemo(() => {
    if (!crew) return "";
    const out: string[] = [];
    for (const group of MODE_GROUPS) {
      const ids = group.modes.map((m) => m.id).filter((id) => games.includes(id));
      const onShow = cardShows(group.modes[0].id, ids);
      for (const id of ids) if (id !== onShow) out.push(`${id}:${crewPuzzle(findGame(id), crew, new Date(now))}`);
    }
    return out.join(",");
  }, [crew, games, cardShows, findGame, now]);
  // Settle each card's starting mode once you're known to have played, or
  // not, every one of them (adjusted while rendering, so it's never shown
  // the other way first; each card is settled only once).
  const unsettled: Record<string, string> = {};
  for (const group of MODE_GROUPS) {
    const id = group.modes[0].id;
    const ids = group.modes.map((m) => m.id).filter((m) => games.includes(m));
    if (ids.length < 2 || cardModes[id] || ids.some((m) => played[m] === undefined)) continue;
    // The first mode still to play, or the first mode if you've played them all.
    unsettled[id] = ids.find((m) => played[m] === false) ?? ids[0];
  }
  if (Object.keys(unsettled).length) setCardModes((m) => ({ ...unsettled, ...m }));
  useEffect(() => {
    if (!crewId || !userId || !otherModes) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      for (const item of otherModes.split(",")) {
        const [game, puzzle] = item.split(":");
        rpc<BoardRow[]>("get_round_board", { p_crew: crewId, p_game: game, p_puzzle: puzzle }).then(
          (rows) => {
            keepBoard(item, rows);
            onPlayed(game, rows.some((r) => r.user_id === userId));
          },
          () => {},
        );
      }
    };
    check();
    const poll = setInterval(check, POLL_MS);
    return () => clearInterval(poll);
  }, [crewId, userId, otherModes, boardsKey, onPlayed, keepBoard]);

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
        (g) => mainId(g.id),
        gameOrder,
      ),
    [rounds, allGames, gameOrder],
  );
  // One choice per game: a game's modes share one, with a switch between them.
  const rankedGroups = useMemo(() => groupItems(rankedGames, (g) => g.id), [rankedGames]);

  // Rankings count only days that end after the owner last reset them (the archive keeps them all).
  const resetAt = crew?.rankings_reset_at ?? null;
  const finishedSinceReset = useMemo(
    () => (resetAt ? finished.filter((r) => Date.parse(r.closes_at) > Date.parse(resetAt)) : finished),
    [finished, resetAt],
  );

  const ranked = useMemo(() => {
    const group = rankedGroups.find((g) => g.id === rankingsGame) ?? rankedGroups[0];
    if (!group || !crew) return null;
    // A game with modes shows the one you picked (even if nobody has played
    // it yet), or else the first one played.
    const modeGroup = groupOf(group.id);
    const picked = modes[group.id];
    const game =
      modeGroup && picked && modeGroup.modes.some((m) => m.id === picked) ? findGame(picked) : group.items[0];
    const zone = crew.timezone ?? "UTC";
    // Finished days only: today's round is on the Today tab.
    const played = finishedSinceReset.filter((r) => r.game === game.id && inPeriod(r, rankingsPeriod, zone, now));
    // Current members only: anyone who left or was removed (including guests
    // removed for being inactive) drops out of the rankings, though their
    // finished days stay in the archive. Matches the extension's rankings.
    const ids = members.map((m) => m.user_id);
    return {
      group: group.id,
      game,
      count: played.length,
      ...crewStats(game, played, ids, { byWinRate: crew.rank_by_win_rate }),
    };
  }, [rankedGroups, rankingsGame, modes, findGame, rankingsPeriod, crew, finishedSinceReset, members, now]);

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
    (g) => mainId(g.id),
    gameOrder,
  );
  // One card per game (`id` is its main mode's): a game with modes shows the
  // one you picked, with a switch to the crew's others.
  const cards = groupItems(tracked, (g) => g.id).map(({ id, items }) => ({
    id,
    game: findGame(cardShows(id, items.map((g) => g.id))),
    modes: items.length > 1 ? items.map((g) => ({ id: g.id, label: modeLabel(g.id) ?? g.name })) : null,
  }));
  // The cards as shown: your order, with games still to play moved up if you
  // asked for that (each falls back into its place once you've played it).
  // A game with modes counts as still to play while any of them is, so it
  // doesn't move when you switch between them.
  const stillToPlay = (c: (typeof cards)[number]) =>
    (c.modes ?? [c.game]).some((m) => played[m.id] === false);
  const shown = toPlayFirstNow ? unplayedFirst(cards, stillToPlay) : cards;
  const isOpen = (cardId: string) => cardsNow[cardId] ?? true;
  const anyCollapsed = cards.some((c) => !isOpen(c.id));
  // The badge counts each mode still to play, not each card.
  const toPlay = cards.reduce((n, c) => n + (c.modes ?? [c.game]).filter((m) => played[m.id] === false).length, 0);
  // Custom games with scores in them have their scoring locked.
  const playedGames = new Set(rounds.filter((rd) => rd.entries.length > 0).map((rd) => rd.game));

  function reorder(ids: string[], toPlayOnTop: boolean) {
    if (!userId || !crewId) return;
    setDragged({ key: orderKey, ids });
    saveGameOrder(userId, crewId, ids);
    setToPlayFirst({ key: orderKey, on: toPlayOnTop });
    saveUnplayedFirst(userId, crewId, toPlayOnTop);
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
              for (const g of next) if (!games.includes(g)) setCardOpen(mainId(g), true);
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
        <div className="card small join-requests-note" role="status">
          <strong>
            {requests.length === 1
              ? `${requests[0].profiles.display_name} wants to join.`
              : `${requests.length} people want to join.`}
          </strong>
          <JoinRequestList
            crew={crew}
            requests={requests}
            onAnswered={() => {
              setBoardsKey((k) => k + 1);
              load();
            }}
          />
        </div>
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
          <RemovedGuestsNotice removals={removals} />
          <DayEndedNotice
            crew={crew}
            rounds={finished}
            findGame={findGame}
            names={names}
            now={now}
            onRankings={() => selectTab("rankings")}
          />
          {/* Each card has its own countdown; games don't all end together. */}
          {cards.length > 0 && (
            <div className="row today-head">
              <p className="today-head-hint muted small">Click on a game to expand its rankings.</p>
              <div className="row today-head-actions">
                {cards.length > 1 && (
                  <button type="button" className="link-btn" aria-haspopup="dialog" onClick={() => setShowReorder(true)}>
                    reorder
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => cards.forEach((c) => setCardOpen(c.id, anyCollapsed))}
                >
                  {anyCollapsed ? "expand all" : "collapse all"}
                </button>
              </div>
              <ReorderGames
                open={showReorder}
                // Each card as one game, under its main mode's id and the game's own name.
                games={cards.map((c) => ({ ...c.game, id: c.id, name: groupName(c.id, c.game.name) }))}
                unplayedFirst={toPlayFirstNow}
                onSave={reorder}
                onClose={() => setShowReorder(false)}
              />
            </div>
          )}
          {cards.length === 0 ? (
            isOwner ? (
              <p className="card">
                Click on a game in the Crew tab to get started.
              </p>
            ) : (
              <p className="muted">The crew owner hasn&apos;t picked any games yet.</p>
            )
          ) : (
            shown.map(({ id, game, modes: cardModes }) => (
              <TodayRound
                // A new mode is a new board: start it afresh.
                key={game.id}
                crew={crew}
                game={game}
                modes={cardModes}
                cachedBoard={cardModes ? modeBoards[`${game.id}:${crewPuzzle(game, crew, new Date(now))}`] : undefined}
                onBoard={cardModes ? keepBoard : undefined}
                onMode={(mode) => {
                  setCardModes((m) => ({ ...m, [id]: mode }));
                  pickMode(id, mode);
                }}
                now={now}
                isOwner={isOwner}
                memberCount={members.length}
                extension={extension.state}
                refreshKey={boardsKey}
                onEdit={isOwner && customOf(game) ? () => setEditing(customOf(game)) : undefined}
                onVoid={(row) => voidEntry(row.display_name, row.entry_id)}
                onPlayed={onPlayed}
                open={isOpen(id)}
                onOpen={(open) => setCardOpen(id, open)}
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
                  value={ranked.group}
                  onChange={(e) => setRankingsGame(e.target.value)}
                >
                  {rankedGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {groupName(g.id, g.items[0].name)}
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
                {/* On the right of the header: which of the game's modes to rank. */}
                {groupOf(ranked.group) && (
                  <ModeSwitch
                    modes={groupOf(ranked.group)!.modes}
                    value={ranked.game.id}
                    onChange={(id) => pickMode(ranked.group, id)}
                    label={`${groupOf(ranked.group)!.name} mode`}
                  />
                )}
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
              modes={modes}
              onMode={pickMode}
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
  modes,
  onMode,
  cachedBoard,
  onBoard,
}: {
  /** The board as last seen (for a game with modes), shown until this one loads. */
  cachedBoard?: BoardRow[];
  /** Hands each loaded board back ("game:puzzle"), to be kept for next time. */
  onBoard?: (key: string, rows: BoardRow[]) => void;
  /** The game's modes the crew plays, when it has more than one: a switch between them. */
  modes?: { id: string; label: string }[] | null;
  onMode?: (mode: string) => void;
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
  const [board, setBoard] = useState<BoardRow[]>(() => cachedBoard ?? []);
  const [loaded, setLoaded] = useState(cachedBoard !== undefined);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const toggle = () => onOpen(!open);
  // A game with modes is named once, with the switch saying which.
  const name = modes ? groupName(game.id, game.name) : game.name;

  const loadBoard = useCallback(
    () =>
      rpc<BoardRow[]>("get_round_board", { p_crew: crew.id, p_game: game.id, p_puzzle: puzzleId }).then(
        (rows) => {
          setBoard(rows);
          setLoaded(true);
          setError(null);
          onBoard?.(`${game.id}:${puzzleId}`, rows);
        },
        (e) => setError(errorMessage(e)),
      ),
    [crew.id, game.id, puzzleId, onBoard],
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
      className={`game-card ${open ? "" : "collapsed"} ${submitted || !loaded ? "" : "unplayed"}`}
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
          <button
            type="button"
            className="game-card-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? "Hide" : "Show"} ${game.name}`}
            onClick={toggle}
          >
            <span className="game-card-chevron" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
          </button>
          {game.url ? (
            <a className="game-card-name" href={game.url} target="_blank" rel="noreferrer" title={`Play ${game.name}`}>
              {name} <span className="game-card-puzzle">{game.puzzleLabel(puzzleId)}</span> <ExternalArrow />
            </a>
          ) : (
            <span className="game-card-name">
              {name} <span className="game-card-puzzle">{game.puzzleLabel(puzzleId)}</span>
            </span>
          )}
        </h3>
        <div className="game-card-right">
          <span className="game-card-summary">
            {loaded ? `${submitted ? "✓ Done" : "Your turn"} · ${board.length}/${memberCount} completed` : "…"}
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
        {/* Tabs at the top of the card: which of the game's modes this board is. */}
        {modes && onMode && <ModeSwitch tabs modes={modes} value={game.id} onChange={onMode} label={`${name} mode`} />}
        {/* Not until the board has loaded (you may well have played already),
            unless it couldn't be: then you can still submit. */}
        {(loaded || error !== null) && !submitted && (
          <SubmitPanel
            crew={crew}
            game={game}
            puzzleId={puzzleId}
            extension={extension}
            onSubmitted={loadBoard}
            // Time left only matters while it's still yours to play, so it lives in this panel.
            timer={
              <span className="time-left">
                <span className="live-dot" aria-hidden>
                  ●
                </span>
                {timeLeft(deadline, now)} left
              </span>
            }
          />
        )}
        {ownClock && loaded && !submitted && <OwnClockNote deadline={deadline} />}
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
 * On a game whose day doesn't end with the crew's (Poople, Krillion), until
 * you've played: when its round closes, in your time. The countdown is in the
 * "Your turn" panel.
 */
function OwnClockNote({ deadline }: { deadline: string }) {
  const clock24h = useClock24h();
  return (
    <p className="game-card-timer muted small">
      New puzzle at <strong>{formatTime(deadline, clock24h)}</strong> your time (NOT midnight).
    </p>
  );
}

/** Dismissing a "guest removed" notice, per removal, in this browser. */
const removedKey = (id: string) => `scrim-guest-removed:${id}`;

/**
 * Guests the cleanup took out of the crew for 48 hours of inactivity, so they
 * don't just vanish from the crew box and rankings. One card for all of them,
 * until dismissed; a later removal brings it back with just the new ones.
 */
function RemovedGuestsNotice({ removals }: { removals: Removal[] }) {
  // Only rendered once the crew has loaded in the browser, so storage is there to read.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const shown = removals.filter((r) => !dismissed.has(r.id) && !wasDismissed(removedKey(r.id)));
  if (shown.length === 0) return null;

  function dismiss() {
    setDismissed((s) => new Set([...s, ...shown.map((r) => r.id)]));
    try {
      for (const r of shown) localStorage.setItem(removedKey(r.id), "1");
    } catch {
      // Storage blocked: it comes back next visit.
    }
  }

  const names = joinNames(shown.map((r) => r.display_name));
  return (
    <div className="card day-ended" role="status">
      <div className="row between day-ended-head">
        <strong>
          {names} {shown.length === 1 ? "was" : "were"} removed for inactivity.
        </strong>
        <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      <p className="muted small">
        Guests are taken out of the crew after 48 hours without playing. Their finished days stay in the archive;
        they can rejoin with the invite link.
      </p>
    </div>
  );
}

/** Dismissing a "games have concluded" notice, per crew and closing time, in this browser. */
const endedKey = (crewId: string, closesAt: string) => `scrim-day-ended:${crewId}:${closesAt}`;

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
 * Once a game's day rolls over: it's over, here's who won, and a nudge to the
 * rankings. Games that closed together (the crew's midnight) share a card; a
 * game on its own clock (Poople) gets its own. Each stays until dismissed.
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
  // Only rendered once the crew has loaded in the browser, so storage is there to read.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // `now` ticks every second; regrouping once a minute is plenty.
  const minute = Math.floor(now / 60_000);

  // Rounds from yesterday on their own game's clock, grouped by when they closed, latest first.
  const groups = useMemo(() => {
    const at = new Date(minute * 60_000);
    const byClose = new Map<string, { id: string; game: GameAdapter<unknown>; winners: string[] }[]>();
    for (const r of rounds) {
      const game = findGame(r.game);
      const zone = roundZone(game, crew);
      if (dayNumber(dateIn(zone, roundDay(r))) !== dayNumber(dateIn(zone, at)) - 1) continue;
      const winners = rankEntries(game, r.entries).filter((e) => e.winner);
      byClose.set(r.closes_at, [
        ...(byClose.get(r.closes_at) ?? []),
        { id: r.id, game, winners: winners.map((w) => names.get(w.user_id) ?? "?") },
      ]);
    }
    return [...byClose].sort(([a], [b]) => Date.parse(b) - Date.parse(a));
  }, [rounds, crew, findGame, names, minute]);

  const shown = groups.filter(([closesAt]) => {
    const key = endedKey(crew.id, closesAt);
    return !dismissed.has(key) && !wasDismissed(key);
  });
  if (shown.length === 0) return null;

  function dismiss(key: string) {
    setDismissed((s) => new Set(s).add(key));
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: it comes back next visit.
    }
  }

  return shown.map(([closesAt, results]) => (
    <div key={closesAt} className="card day-ended" role="status">
      <div className="row between day-ended-head">
        <strong>The following games have concluded from yesterday:</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => dismiss(endedKey(crew.id, closesAt))}
        >
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
  ));
}


/** closes_at is the midnight that ended the day; this is a moment in the day itself. */
const roundDay = (round: Round) => new Date(new Date(round.closes_at).getTime() - 60_000);

/** The most games shown as dots on a calendar day; more show as "+2" and so on. */
const CAL_DOTS = 3;

/** Past rounds on a month calendar: a day with results opens its games in a modal. */
function Archive({
  rounds,
  order,
  modes,
  onMode,
  findGame,
  names,
  isOwner,
  onVoid,
}: {
  rounds: RoundWithEntries[];
  /** Game ids in the order the crew's Games box lists them; each day's games follow it. */
  order: string[];
  /** The mode picked for each game with modes (by its main mode's id). */
  modes: Record<string, string>;
  onMode: (group: string, mode: string) => void;
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
    for (const [key, list] of byDay) byDay.set(key, inSavedOrder(list, (r) => mainId(r.game), order));
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
  // A game's modes played that day are one item, with a switch between them.
  const dayGroups = groupItems(openDay ? (days.get(openDay) ?? []) : [], (r) => r.game);

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
          // A dot per game: its modes share one.
          const dots = list ? groupItems(list, (r) => r.game).map((g) => g.items[0]) : [];
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
                {/* Three at most, to keep the day tidy; the rest as a count. */}
                {dots.slice(0, CAL_DOTS).map((r) => (
                  <span key={r.id} className="archive-cal-dot" style={gameStyle(findGame(r.game))} />
                ))}
                {dots.length > CAL_DOTS && <span className="archive-cal-more">+{dots.length - CAL_DOTS}</span>}
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
          {dayGroups.map(({ id, items }) => {
            const round = items.find((r) => r.game === modes[id]) ?? items[0];
            const game = findGame(round.game);
            return (
              <PastRound
                key={id}
                game={game}
                round={round}
                names={names}
                isOwner={isOwner}
                onVoid={onVoid}
                switcher={
                  items.length > 1 ? (
                    <ModeSwitch
                      modes={items.map((r) => ({ id: r.game, label: modeLabel(r.game) ?? findGame(r.game).name }))}
                      value={round.game}
                      onChange={(mode) => onMode(id, mode)}
                      label={`${groupName(id, game.name)} mode`}
                    />
                  ) : null
                }
              />
            );
          })}
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
  switcher,
}: {
  /** A switch between the game's modes played that day, if more than one was. */
  switcher?: React.ReactNode;
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
            {/* With a switch, the game is named once and the switch says which mode. */}
            <GameTag game={switcher ? { ...game, name: groupName(game.id, game.name) } : game} />{" "}
            {game.puzzleLabel(round.puzzle_id)} {switcher}
          </span>
          <span>
            {winners.length
              ? `★ ${winners.map((w) => names.get(w.user_id) ?? "?").join(", ")} · ${game.formatScore(winners[0].result)}`
              : "no winner"}
          </span>
        </summary>
        <div className="past-round-board">
          <Scoreboard game={game} rows={rows} closed canVoid={isOwner} onVoid={onVoid} showTime={false} />
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
  // The list folds away behind its label. It opens on every visit; folding it lasts only this one.
  const [showList, setShowList] = useState(true);
  const listId = useId();

  // A game with modes turns all of them on or off (the server does the same).
  const idsOf = (game: GameAdapter<unknown>) => groupOf(game.id)?.modes.map((m) => m.id) ?? [game.id];
  const isOn = (game: GameAdapter<unknown>) => idsOf(game).some((id) => games.includes(id));
  const nameOf = (game: GameAdapter<unknown>) => groupName(game.id, game.name);

  async function toggle(game: GameAdapter<unknown>) {
    const ids = idsOf(game);
    const on = !isOn(game);
    if (!on && !skipRemoveGameConfirm()) {
      const dontAsk = await confirmWithOption(
        `Stop playing ${nameOf(game)} in ${crew.name}? You can bring it back later - archived rankings stay.`,
        "Don't ask again",
      );
      if (dontAsk === null) return;
      if (dontAsk) setSkipRemoveGameConfirm();
    }
    setBusy(game.id);
    setError(null);
    try {
      await rpc("set_crew_game", { p_crew: crew.id, p_game: game.id, p_tracked: on });
      onGames(on ? [...games, ...ids.filter((id) => !games.includes(id))] : games.filter((g) => !ids.includes(g)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crew-games">
      <button
        type="button"
        className="crew-games-label crew-games-toggle"
        aria-expanded={showList}
        aria-controls={listId}
        title={showList ? "Hide the games" : "Show the games"}
        onClick={() => setShowList(!showList)}
      >
        Games
        {!showList && <span className="crew-games-hint"> (Click to expand)</span>}
        {/* In the box's top-right corner: points down to open, up to fold away. */}
        <svg className={`crew-games-chevron${showList ? " open" : ""}`} viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {showList && (
        <div className="crew-games-list" id={listId}>
          {isOwner ? (
            <>
              <ul className="game-toggles">
                {allGames.map((g) => {
                  const on = isOn(g);
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        className="game-toggle"
                        style={gameStyle(g)}
                        aria-pressed={on}
                        disabled={busy !== null}
                        title={on ? `Stop playing ${nameOf(g)}` : `Play ${nameOf(g)} in this crew`}
                        onClick={() => toggle(g)}
                      >
                        <span aria-hidden>{on ? "✓" : "+"}</span> {nameOf(g)}
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
          ) : (
            // Everyone else sees the same list, read-only: what's played is filled in.
            <ul className="game-toggles">
              {allGames
                // A custom game the crew isn't playing is the owner's business.
                .filter((g) => isOn(g) || !isCustomGameId(g.id))
                .map((g) => {
                  const on = isOn(g);
                  return (
                    <li key={g.id}>
                      <span className={`game-toggle static${on ? " on" : ""}`} style={gameStyle(g)}>
                        {on && <span aria-hidden>✓ </span>}
                        {nameOf(g)}
                        {!on && <span className="sr-only"> (not played)</span>}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * People asking to join, each with Approve and Decline (they're told when they
 * next open the link). Shown to the owner on the crew page.
 */
function JoinRequestList({
  crew,
  requests,
  onAnswered,
}: {
  crew: Crew;
  requests: JoinRequest[];
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(r: JoinRequest, approve: boolean) {
    setBusy(`${approve ? "approve" : "decline"}:${r.user_id}`);
    setError(null);
    try {
      await rpc("answer_join_request", { p_crew: crew.id, p_user: r.user_id, p_approve: approve });
      onAnswered();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
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
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/**
 * "Don't ask again" when removing a game from a crew. Kept in sessionStorage,
 * so it lasts until the tab is closed.
 */
const SKIP_REMOVE_GAME_CONFIRM = "scrim:skip-remove-game-confirm";

function skipRemoveGameConfirm(): boolean {
  try {
    return sessionStorage.getItem(SKIP_REMOVE_GAME_CONFIRM) === "1";
  } catch {
    return false;
  }
}

function setSkipRemoveGameConfirm() {
  try {
    sessionStorage.setItem(SKIP_REMOVE_GAME_CONFIRM, "1");
  } catch {
    // Storage blocked: it'll just ask next time.
  }
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
  onCrew,
  onRemoved,
  onDeleted,
  onTransferred,
}: {
  crew: Crew;
  members: Member[];
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
        <div className="row">
          <select
            className="input grow"
            aria-label="New owner"
            value={heir}
            disabled={busy !== null || heirs.length === 0}
            aria-describedby={heirs.length === 0 ? "no-heirs" : undefined}
            onChange={(e) => setHeir(e.target.value)}
          >
            <option value="">{heirs.length === 0 ? "No eligible members" : "Choose a member…"}</option>
            {heirs.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profiles.display_name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-small"
            disabled={busy !== null || !heirs.some((m) => m.user_id === heir)}
            onClick={transfer}
          >
            {busy === "transfer" ? "Transferring…" : "Transfer"}
          </button>
        </div>
        {heirs.length === 0 && (
          <p className="muted small" id="no-heirs">
            Nobody to hand it to yet. The new owner has to be in the crew, signed in with Google (not a guest).
          </p>
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
