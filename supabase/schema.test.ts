// Runs the real migrations in an in-memory Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then exercises the RPCs and RLS rules
// as different users.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { manualConnections } from "@/games/connections";
import { manualKrillion } from "@/games/krillion";
import { manualStrands } from "@/games/strands";
import { GAMES } from "@/games/registry";
import { crewStats } from "@/lib/stats";
import { manualWordle } from "@/games/wordle";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, MIGRATIONS_DIR), "utf8"));

const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (
    id uuid primary key,
    raw_user_meta_data jsonb not null default '{}',
    is_anonymous boolean not null default false
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  -- Like Supabase: every new function in public is callable by the API roles
  -- unless a migration takes that away.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

// Deliberately no default table grants: newer Supabase projects don't add
// them, so the migrations must grant everything the app needs.

const ANN = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const EVE = "00000000-0000-0000-0000-00000000000e";

let db: PGlite;

/** Run a query as a signed-in user (or anon when null), with RLS applied. */
async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${user ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
    return (await tx.query<T>(sql, params)).rows;
  });
}

const grid = (...rows: string[]) => JSON.stringify(rows);
/** A solved Wordle result. Pasted results need a grid, so it gets a plain one by default. */
const solve = (puzzle: string, guesses: number, rows?: string) =>
  `{"puzzle":"${puzzle}","solved":true,"guesses":${guesses},"hard":false,"grid":${
    rows ?? grid(...Array(Math.max(guesses - 1, 0)).fill(".y..."), "ggggg")
  }}`;
const MISS_GRID = grid(...Array(6).fill(".y..."));

/** Today's Wordle number by UTC date, which is always "today" somewhere. */
let T: string;
/** A past puzzle. */
let OLD: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values
     ($1, '{"display_name":"Ann"}'), ($2, '{"full_name":"Bob Google"}'), ($3, '{}')`,
    [ANN, BOB, EVE],
  );
  const { rows } = await db.query<{ n: number }>(
    "select ((now() at time zone 'UTC')::date - date '2021-06-19') as n",
  );
  T = String(rows[0].n);
  OLD = String(rows[0].n - 5);
});

type CrewRow = { id: string; invite_code: string };

/** Crews default to UTC, so a round for T closes at the next UTC midnight. */
const createCrew = async (user: string, name: string, ...games: string[]) => {
  const crew = (await as<CrewRow>(user, "select * from create_crew($1, 'UTC')", [name]))[0];
  for (const game of games) await as(user, "select set_crew_game($1, $2, true)", [crew.id, game]);
  return crew;
};

/**
 * Accounts own at most 4 crews, so a test group that makes crews for Ann
 * first deletes the ones earlier groups made (each group uses only its own).
 */
const clearCrewsOf = (user: string) => db.query("delete from crews where created_by = $1", [user]);

const submitEntry = (user: string, crew: string, result: string, source = "paste", game = "wordle") =>
  as(user, "select submit_entry($1, $2, $3, 'Shared result', $4)", [crew, game, result, source]);

const board = (user: string, crew: string, puzzle: string, game = "wordle") =>
  as<{ entry_id: string; user_id: string; display_name: string; hidden: boolean; source: string; result: unknown }>(
    user,
    "select * from get_round_board($1, $2, $3)",
    [crew, game, puzzle],
  );

/**
 * Writes finished rounds straight into the database (past days can't be
 * submitted through the API), with each player's Wordle result.
 */
async function insertRounds(
  crewId: string,
  rounds: { id: string; closes_at: string; entries: { user_id: string; result: { puzzle: string } }[] }[],
) {
  for (const r of rounds) {
    await db.query("insert into rounds (id, crew_id, game, puzzle_id, closes_at) values ($1, $2, 'wordle', $3, $4)", [
      r.id,
      crewId,
      r.entries[0].result.puzzle,
      r.closes_at,
    ]);
    for (const e of r.entries) {
      await db.query("insert into entries (round_id, user_id, result, source) values ($1, $2, $3, 'paste')", [
        r.id,
        e.user_id,
        JSON.stringify(e.result),
      ]);
    }
  }
}

describe("schema", () => {
  let crew: CrewRow;

  it("creates profiles for new users", async () => {
    const rows = await as(ANN, "select id, display_name from profiles order by id");
    expect(rows.map((r) => r.display_name)).toEqual(["Ann", "Bob Google", "Player"]);
  });

  it("lets you rename yourself but nobody else", async () => {
    await as(ANN, "update profiles set display_name = 'Annie' where id = $1", [ANN]);
    await as(ANN, "update profiles set display_name = 'hacked' where id = $1", [BOB]);
    const rows = await as<{ display_name: string }>(ANN, "select display_name from profiles order by id");
    expect(rows.map((r) => r.display_name)).toEqual(["Annie", "Bob Google", "Player"]);
    await expect(as(ANN, "update profiles set created_at = now() where id = $1", [ANN])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("creates a crew in the creator's time zone", async () => {
    await expect(as(ANN, "select create_crew('X', 'Mars/Olympus')")).rejects.toThrow(/time zone/);
    await expect(as(ANN, "select create_crew('X', null)")).rejects.toThrow(/time zone/);
    const [la] = await as<{ id: string; timezone: string }>(ANN, "select * from create_crew('West', 'America/Los_Angeles')");
    expect(la.timezone).toBe("America/Los_Angeles");
    await as(ANN, "select delete_crew($1)", [la.id]); // accounts own at most 4 crews
    crew = await createCrew(ANN, "Breakfast Club");
  });

  it("only takes results for games the crew plays", async () => {
    await expect(submitEntry(ANN, crew.id, solve(T, 3))).rejects.toThrow(/doesn't play wordle/);
    await expect(as(BOB, "select set_crew_game($1, 'wordle', true)", [crew.id])).rejects.toThrow(/Only the crew owner/);
    await expect(as(ANN, "select set_crew_game($1, 'spelling-bee', true)", [crew.id])).rejects.toThrow(
      /Unsupported game/,
    );
    await as(ANN, "select set_crew_game($1, 'wordle', true)", [crew.id]);
    await as(ANN, "select set_crew_game($1, 'wordle', true)", [crew.id]); // idempotent
    expect(await as(ANN, "select game from crew_games where crew_id = $1", [crew.id])).toEqual([{ game: "wordle" }]);
  });

  it("hides crews and rounds from non-members", async () => {
    expect(await as(EVE, "select * from crews")).toHaveLength(0);
    await expect(submitEntry(EVE, crew.id, solve(T, 1))).rejects.toThrow(/not found/);
  });

  it("joins the crew through its invite", async () => {
    await as(BOB, "select join_crew($1)", [crew.invite_code.toUpperCase()]);
    expect(await as(BOB, "select * from crews")).toHaveLength(1);
  });

  it("starts the day's round with the first result", async () => {
    expect(await board(BOB, crew.id, T)).toEqual([]);
    await submitEntry(BOB, crew.id, solve(T, 2, grid("y.y..", "ggggg")), "paste");
    const rounds = await as<{ puzzle_id: string; closes_at: Date }>(BOB, "select * from rounds");
    expect(rounds).toHaveLength(1);
    expect(rounds[0].puzzle_id).toBe(T);
    // Midnight UTC at the end of the puzzle's day.
    const { rows } = await db.query<{ t: Date }>(
      "select (date '2021-06-19' + $1::int + 1)::timestamp at time zone 'UTC' as t",
      [T],
    );
    expect(rounds[0].closes_at).toEqual(rows[0].t);
  });

  it("hides results until you submit your own", async () => {
    expect(await board(ANN, crew.id, T)).toMatchObject([{ display_name: "Bob Google", hidden: true, result: null }]);
    expect(await as(ANN, "select * from entries")).toHaveLength(0);

    await submitEntry(ANN, crew.id, solve(T, 2));
    const after = await board(ANN, crew.id, T);
    expect(after.map((r) => [r.hidden, (r.result as { guesses: number }).guesses])).toEqual([
      [false, 2],
      [false, 2],
    ]);
    expect(await as(ANN, "select * from entries")).toHaveLength(2);
    expect(await as(BOB, "select * from rounds")).toHaveLength(1);
  });

  it("validates results server-side", async () => {
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    const submit = (result: string) => submitEntry(EVE, crew.id, result);
    await expect(submit(solve(OLD, 3))).rejects.toThrow(/day is over/);
    await expect(submit(solve(String(Number(T) + 5), 3))).rejects.toThrow(/day is over/);
    await expect(submit(`{"puzzle":"x1","solved":true,"guesses":1,"grid":["ggggg"]}`)).rejects.toThrow(/Invalid puzzle/);
    await expect(submit(solve(T, 9))).rejects.toThrow(/between 1 and 6/);
    await expect(submit(solve(T, 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
    await expect(submit(solve(T, 1, grid("hello")))).rejects.toThrow(/Invalid grid row/);
    await expect(
      as(EVE, "select submit_entry($1, 'wordle', $2, '', 'extension')", [crew.id, solve(T, 1)]),
    ).rejects.toThrow(/Invalid source/);

    // Pasted results need their grid.
    await expect(submit(`{"puzzle":"${T}","solved":true,"guesses":2,"hard":false}`)).rejects.toThrow(/coloured grid/);

    // Junk fields are dropped; misses are stored without guesses.
    await submit(`{"puzzle":"${T}","solved":false,"guesses":4,"hard":true,"evil":1,"grid":${MISS_GRID}}`);
    const [row] = await as<{ result: object }>(EVE, "select result from entries where user_id = $1", [EVE]);
    expect(row.result).toEqual({ puzzle: T, solved: false, hard: true, grid: JSON.parse(MISS_GRID) });
    await expect(submit(solve(T, 3))).rejects.toThrow(/already submitted/);
    // Rejected puzzles never start a round.
    expect(await as(EVE, "select puzzle_id from rounds")).toEqual([{ puzzle_id: T }]);
  });

  it("only lets the crew owner void entries", async () => {
    const [eve] = await as<{ id: string }>(ANN, "select id from entries where user_id = $1", [EVE]);
    await expect(as(BOB, "select void_entry($1)", [eve.id])).rejects.toThrow(/Only the crew owner/);
    await as(ANN, "select void_entry($1)", [eve.id]);
    await submitEntry(EVE, crew.id, solve(T, 4));
  });

  it("closes the round at the deadline", async () => {
    await db.query("update rounds set closes_at = now() - interval '1 minute' where crew_id = $1", [crew.id]);
    await expect(submitEntry(BOB, crew.id, solve(T, 3))).rejects.toThrow(/already submitted|day is over/);
    // Closed rounds show everything, even to players who didn't submit.
    await as(ANN, "select void_entry((select id from entries where user_id = $1))", [ANN]);
    expect((await board(ANN, crew.id, T)).every((r) => !r.hidden)).toBe(true);
    await expect(submitEntry(ANN, crew.id, solve(T, 3))).rejects.toThrow(/day is over/);
  });

  it("lets only the owner change crew settings", async () => {
    await expect(as(BOB, "select update_crew_settings($1, 'Asia/Tokyo')", [crew.id])).rejects.toThrow(
      /Only the crew owner/,
    );
    await expect(as(ANN, "select update_crew_settings($1, 'Nowhere')", [crew.id])).rejects.toThrow(/time zone/);
    const [c] = await as<{ timezone: string; hide_until_submitted: boolean }>(
      ANN,
      "select * from update_crew_settings($1, p_timezone => 'Asia/Tokyo')",
      [crew.id],
    );
    expect(c).toMatchObject({ timezone: "Asia/Tokyo", hide_until_submitted: true });
    expect(c).not.toHaveProperty("allow_manual");

    await expect(as(BOB, "select update_crew_settings($1, p_name => 'Mine now')", [crew.id])).rejects.toThrow(
      /Only the crew owner/,
    );
    await expect(as(ANN, "select update_crew_settings($1, p_name => '   ')", [crew.id])).rejects.toThrow(/1 to 16/);
    await expect(as(ANN, "select update_crew_settings($1, p_name => $2)", [crew.id, "x".repeat(17)])).rejects.toThrow(
      /1 to 16/,
    );
    const [renamed] = await as<{ name: string; timezone: string }>(
      ANN,
      "select * from update_crew_settings($1, p_name => '  Brunch Club ')",
      [crew.id],
    );
    expect(renamed).toMatchObject({ name: "Brunch Club", timezone: "Asia/Tokyo" });
    await as(ANN, "select update_crew_settings($1, p_name => 'Breakfast Club')", [crew.id]);
  });

  it("only takes pasted results from the site, and shows scores right away when the crew allows it", async () => {
    const c = await createCrew(ANN, "Paste Only", "wordle");
    await as(BOB, "select join_crew($1)", [c.invite_code]);
    await as(ANN, "select update_crew_settings($1, p_hide_until_submitted => false)", [c.id]);
    await expect(submitEntry(BOB, c.id, solve(T, 3), "manual")).rejects.toThrow(/Invalid source/);
    await expect(as(BOB, "select submit_entry($1, 'wordle', $2, '  ', 'paste')", [c.id, solve(T, 3)])).rejects.toThrow(
      /share text/,
    );
    await submitEntry(BOB, c.id, solve(T, 3));
    expect(await board(ANN, c.id, T)).toMatchObject([{ hidden: false, result: { guesses: 3 } }]);
  });

  it("does not let signed-out visitors call RPCs or read/write tables directly", async () => {
    await expect(as(null, "select create_crew('nope', 'UTC')")).rejects.toThrow(/permission denied/);
    await expect(as(null, "select * from profiles")).rejects.toThrow(/permission denied/);
    await expect(
      as(ANN, "select record_entry($1, $2, 'wordle', $3, '', 'extension')", [ANN, crew.id, solve(T, 1)]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(ANN, "insert into rounds (crew_id, game, puzzle_id, closes_at) values ($1, 'wordle', '1', now())", [crew.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(as(ANN, "insert into crew_games (crew_id, game) values ($1, 'krillion')", [crew.id])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("extension", () => {
  let bobToken: string;
  let annToken: string;
  let eveToken: string;
  let weekend: CrewRow;

  const submit = (token: string, result: string) =>
    as<{ crew_code: string; crew_name: string; outcome: string }>(
      null,
      `select * from extension_submit($1, 'wordle', $2, 'auto')`,
      [token, result],
    );
  const outcomes = (rows: { crew_name: string; outcome: string }[]) => rows.map((r) => [r.crew_name, r.outcome]);
  const mint = async (user: string) =>
    (await as<{ create_extension_token: string }>(user, "select create_extension_token()"))[0].create_extension_token;

  beforeAll(async () => {
    bobToken = await mint(BOB);
    annToken = await mint(ANN);
    eveToken = await mint(EVE);
    // Ann already has Breakfast Club (closed for today) and Paste Only.
    weekend = await createCrew(ANN, "Weekend", "wordle");
    await as(BOB, "select join_crew($1)", [weekend.invite_code]);
    await as(EVE, "select join_crew($1)", [weekend.invite_code]);
    await createCrew(ANN, "Work", "wordle");
    // A crew that doesn't play Wordle, which Wordle results skip. Bob joins
    // (Ann's already in 4 crews, the most anyone can be in).
    const krillionOnly = await createCrew(EVE, "Krillion Only", "krillion");
    await as(BOB, "select join_crew($1)", [krillionOnly.invite_code]);
  });

  it("only signed-in users can mint tokens, and tokens are stored hashed", async () => {
    expect(bobToken).toMatch(/^[0-9a-f]{64}$/);
    await expect(as(null, "select create_extension_token()")).rejects.toThrow(/permission denied/);
    await expect(as(BOB, "select * from extension_tokens")).rejects.toThrow(/permission denied/);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from extension_tokens where token_hash = convert_to($1, 'UTF8')",
      [bobToken],
    );
    expect(rows[0].n).toBe(0);
  });

  it("submits to every crew that plays the game, starting rounds as needed", async () => {
    expect(outcomes(await submit(annToken, solve(T, 2, grid(".y...", "ggggg"))))).toEqual([
      ["Breakfast Club", "closed"],
      ["Paste Only", "submitted"],
      ["Weekend", "submitted"],
      ["Work", "submitted"],
    ]);
    // Bob isn't in Work.
    expect(outcomes(await submit(bobToken, solve(T, 4)))).toEqual([
      ["Breakfast Club", "closed"],
      ["Paste Only", "already"],
      ["Weekend", "submitted"],
    ]);
    expect((await board(BOB, weekend.id, T)).map((r) => r.source)).toEqual(["extension", "extension"]);
  });

  it("is idempotent and skips puzzles whose day is over", async () => {
    expect(outcomes(await submit(bobToken, solve(T, 1))).at(-1)).toEqual(["Weekend", "already"]);
    expect(outcomes(await submit(bobToken, solve(OLD, 3)))).toEqual([
      ["Breakfast Club", "closed"],
      ["Paste Only", "closed"],
      ["Weekend", "closed"],
    ]);
  });

  it("still validates results", async () => {
    await expect(submit(eveToken, solve(T, 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
  });

  it("doesn't take a voided result back, but takes a new one", async () => {
    // Bob's 4/6 is in Weekend (Ann's crew) from earlier.
    const weekendOutcome = async (result: string) =>
      (await submit(bobToken, result)).find((r) => r.crew_name === "Weekend")?.outcome;
    const bobs = async () =>
      ((await board(ANN, weekend.id, T)) as { entry_id: string; user_id: string }[]).filter((e) => e.user_id === BOB);
    const [entry] = await bobs();
    await as(ANN, "select void_entry($1)", [entry.entry_id]);

    // The extension sending it again (it keeps what it's seen) changes nothing.
    expect(await weekendOutcome(solve(T, 4))).toBe("voided");
    await expect(
      as(BOB, "select submit_entry($1, 'wordle', $2, 'pasted', 'paste')", [weekend.id, solve(T, 4)]),
    ).rejects.toThrow(/voided this result/);
    expect(await bobs()).toHaveLength(0);
    // Playing again gives a different result, which counts.
    expect(await weekendOutcome(solve(T, 5))).toBe("submitted");
    expect(await bobs()).toHaveLength(1);
    // The record of the void isn't readable from the API.
    await expect(as(BOB, "select * from voided_entries")).rejects.toThrow(/permission denied/);
  });

  it("lets only the first Scrim account to send a game have it", async () => {
    const player = "a".repeat(64);
    const send = (token: string, result: string, who: string | null = player) =>
      as<{ crew_code: string | null; crew_name: string | null; outcome: string }>(
        null,
        `select * from extension_submit($1, 'wordle', $2, 'auto', $3)`,
        [token, result, who],
      );
    // Eve plays first: it's hers, in every crew of hers.
    expect((await send(eveToken, solve(T, 3))).find((r) => r.crew_name === "Weekend")?.outcome).toBe("submitted");
    // The same game (same player, game and puzzle) from Ann's account goes nowhere.
    expect(await send(annToken, solve(T, 3))).toEqual([{ crew_code: null, crew_name: null, outcome: "not-yours" }]);
    // Eve sending it again is fine.
    expect((await send(eveToken, solve(T, 3))).find((r) => r.crew_name === "Weekend")?.outcome).toBe("already");
    // A different player is a different game.
    expect((await send(annToken, solve(T, 3), "b".repeat(64))).every((r) => r.outcome !== "not-yours")).toBe(true);
    // The claim is made even when it counts nowhere (here, a day that's over).
    const late = "c".repeat(64);
    expect((await send(eveToken, solve(OLD, 3), late)).every((r) => r.outcome === "closed")).toBe(true);
    expect(await send(annToken, solve(OLD, 3), late)).toEqual([{ crew_code: null, crew_name: null, outcome: "not-yours" }]);
    // Junk players are refused, and the claims aren't readable from the API.
    await expect(send(annToken, solve(T, 3), "not-a-hash")).rejects.toThrow(/Invalid player/);
    await expect(as(BOB, "select * from game_claims")).rejects.toThrow(/permission denied/);
  });

  it("rejects unknown and revoked tokens", async () => {
    await expect(submit("nope", solve(T, 3))).rejects.toThrow(/not connected/);
    await as(BOB, "select revoke_extension_tokens()");
    await expect(submit(bobToken, solve(T, 3))).rejects.toThrow(/not connected/);
    expect(outcomes(await submit(annToken, solve(T, 3))).at(-1)).toEqual(["Work", "already"]);
  });
});

describe("crew owner controls", () => {
  beforeAll(() => clearCrewsOf(ANN));
  let crew: CrewRow;

  beforeAll(async () => {
    crew = await createCrew(ANN, "Owner Tests", "wordle");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    await submitEntry(EVE, crew.id, solve(T, 3));
    await submitEntry(BOB, crew.id, solve(T, 4));
  });

  it("only the owner can remove members, and not themselves", async () => {
    await expect(as(BOB, "select remove_crew_member($1, $2)", [crew.id, EVE])).rejects.toThrow(/Only the crew owner/);
    await expect(as(ANN, "select remove_crew_member($1, $2)", [crew.id, ANN])).rejects.toThrow(/themselves/);
  });

  it("removes the member and their open entries, and lets them rejoin", async () => {
    await as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE]);
    const members = await as<{ user_id: string }>(ANN, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([ANN, BOB]);
    expect((await board(ANN, crew.id, T)).map((r) => r.user_id)).toEqual([BOB]);
    expect(await as(EVE, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    await expect(as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE])).rejects.toThrow(/Not a member/);
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    expect(await as(EVE, "select * from crews where id = $1", [crew.id])).toHaveLength(1);
    await as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE]);
  });

  it("lets members leave, taking their open entries with them", async () => {
    await expect(as(ANN, "select leave_crew($1)", [crew.id])).rejects.toThrow(/owner can't leave/);
    await as(BOB, "select leave_crew($1)", [crew.id]);
    expect(await as(BOB, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    expect(await board(ANN, crew.id, T)).toEqual([]);
    // Leaving isn't a ban.
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
  });

  it("keeps past rounds when a game is untracked", async () => {
    await as(ANN, "select set_crew_game($1, 'wordle', false)", [crew.id]);
    expect(await as(ANN, "select * from crew_games where crew_id = $1", [crew.id])).toHaveLength(0);
    expect(await as(ANN, "select * from rounds where crew_id = $1", [crew.id])).toHaveLength(1);
    await expect(submitEntry(BOB, crew.id, solve(T, 2))).rejects.toThrow(/doesn't play/);
  });

  it("only the owner can delete the crew, which removes everything in it", async () => {
    await expect(as(BOB, "select delete_crew($1)", [crew.id])).rejects.toThrow(/Only the crew owner/);
    await as(ANN, "select delete_crew($1)", [crew.id]);
    expect(await as(ANN, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    const { rows } = await db.query<{ rounds: number; bans: number }>(
      `select (select count(*)::int from rounds where crew_id = $1) as rounds,
              (select count(*)::int from crew_bans where crew_id = $1) as bans`,
      [crew.id],
    );
    expect(rows[0]).toEqual({ rounds: 0, bans: 0 });
  });
});

describe("connections and krillion", () => {
  beforeAll(() => clearCrewsOf(ANN));
  let crew: string;
  let C: string;
  let K: string;
  const submit = (user: string, game: string, result: object) =>
    submitEntry(user, crew, JSON.stringify(result), "paste", game);
  const stored = async (user: string, game: string) =>
    (
      await as<{ result: Record<string, unknown> }>(
        user,
        "select e.result from entries e join rounds r on r.id = e.round_id where e.user_id = $1 and r.game = $2",
        [user, game],
      )
    )[0].result;

  beforeAll(async () => {
    const c = await createCrew(ANN, "More Games", "connections");
    crew = c.id;
    await as(BOB, "select join_crew($1)", [c.invite_code]);
    await as(EVE, "select join_crew($1)", [c.invite_code]);
    const { rows } = await db.query<{ c: number; k: number }>(
      `select ((now() at time zone 'UTC')::date - date '2023-06-11') as c,
              ((now() at time zone 'America/New_York')::date - date '2026-07-15') as k`,
    );
    C = String(rows[0].c);
    K = String(rows[0].k);
  });

  it("only allows today's puzzle", async () => {
    await expect(
      submit(EVE, "connections", { puzzle: String(Number(C) - 5), grid: ["yyyy", "gggg", "bbbb", "pppp"] }),
    ).rejects.toThrow(/day is over/);
  });

  it("scores Connections from the grid and validates it", async () => {
    await expect(
      submit(EVE, "connections", { puzzle: C, solved: true, mistakes: 0, grid: ["yyyy", "yyyy", "bbbb", "pppp"] }),
    ).rejects.toThrow(/does not match/);
    await expect(submit(EVE, "connections", { puzzle: C, grid: ["yyyy", "gbgg"] })).rejects.toThrow(/finished/);
    // Claimed perfect, but the grid has a mistake: the grid wins.
    await submit(BOB, "connections", {
      puzzle: C,
      solved: true,
      mistakes: 0,
      grid: ["yyyy", "gbgg", "gggg", "bbbb", "pppp"],
    });
    expect(await stored(BOB, "connections")).toMatchObject({ solved: true, mistakes: 1, groups: 4 });
    await expect(submit(EVE, "connections", { puzzle: C, solved: false, groups: 2, mistakes: 0 })).rejects.toThrow(
      /coloured grid/,
    );
    const loss = ["yyyy", "gggg", "bbpp", "pbpb", "bppb", "pbbp"];
    await submit(EVE, "connections", { puzzle: C, solved: true, mistakes: 0, grid: loss });
    expect(await stored(EVE, "connections")).toEqual({ puzzle: C, solved: false, mistakes: 4, groups: 2, grid: loss });
  });

  it("scores Krillion from the tiers, bounds depth, and closes at New York midnight", async () => {
    await expect(submit(ANN, "krillion", { puzzle: K, tiers: "sssssss" })).rejects.toThrow(/doesn't play krillion/);
    await as(ANN, "select set_crew_game($1, 'krillion', true)", [crew]);
    await expect(submit(EVE, "krillion", { puzzle: String(Number(K) - 1), tiers: "sssssss" })).rejects.toThrow(
      /day is over/,
    );
    await submit(ANN, "krillion", { puzzle: K, points: 700, tiers: "sprxksd" });
    expect(await stored(ANN, "krillion")).toEqual({ puzzle: K, points: 315, tiers: "sprxksd" });
    // A score with no answers isn't a paste.
    await expect(submit(EVE, "krillion", { puzzle: K, points: 700 })).rejects.toThrow(/coloured grid/);
    // The score bound still holds for results without answers (none arrive that way now).
    await expect(db.query("select normalize_result('krillion', $1, $2)", [K, JSON.stringify({ puzzle: K, points: 701 })])).rejects.toThrow(
      /between/,
    );
    await expect(submit(EVE, "krillion", { puzzle: K, tiers: "kkkkkkkk" })).rejects.toThrow(/Invalid answers/);

    const { rows } = await db.query<{ ok: boolean }>(
      `select closes_at = ((date '2026-07-15' + $1::int + 1)::timestamp at time zone 'America/New_York') as ok
       from rounds where crew_id = $2 and game = 'krillion'`,
      [K, crew],
    );
    expect(rows).toEqual([{ ok: true }]);
  });

  it("scores Strands from its dots, and closes at the crew's midnight", async () => {
    const { rows: n } = await db.query<{ s: number }>(
      "select ((now() at time zone 'UTC')::date - date '2024-03-03') as s",
    );
    const S = String(n[0].s);
    await as(ANN, "select set_crew_game($1, 'strands', true)", [crew]);
    await expect(submit(EVE, "strands", { puzzle: String(Number(S) - 5), grid: "sbbb" })).rejects.toThrow(/day is over/);
    // Claimed no hints, but the dots have two: the dots win.
    await submit(ANN, "strands", { puzzle: S, hints: 0, grid: "hbbbbshbb" });
    expect(await stored(ANN, "strands")).toEqual({ puzzle: S, hints: 2, words: 7, spangram: 5, grid: "hbbbbshbb" });
    await expect(submit(EVE, "strands", { puzzle: S, hints: 0 })).rejects.toThrow(/coloured grid/);
    await expect(submit(EVE, "strands", { puzzle: S, grid: "bbbb" })).rejects.toThrow(/one spangram/);
    await expect(submit(EVE, "strands", { puzzle: S, grid: "sbxb" })).rejects.toThrow(/Invalid result/);

    const { rows } = await db.query<{ ok: boolean }>(
      `select closes_at = ((date '2024-03-03' + $1::int + 1)::timestamp at time zone 'UTC') as ok
       from rounds where crew_id = $2 and game = 'strands'`,
      [S, crew],
    );
    expect(rows).toEqual([{ ok: true }]);
  });
});

describe("extension rankings", () => {
  beforeAll(() => clearCrewsOf(ANN));
  const samples: Record<string, object[]> = {
    wordle: [1, 2, 3, 6, null].map((g) => manualWordle("1", g, false)),
    connections: [
      manualConnections("1", 0),
      manualConnections("1", 2),
      manualConnections("1", 3),
      manualConnections("1", null, 3),
      manualConnections("1", null, 0),
    ],
    krillion: [0, 15, 300, 700].map((p) => manualKrillion("1", p)),
    strands: [0, 1, 1, 4].map((h) => manualStrands("1", h)),
  };

  it("judges results the same way as the site", async () => {
    for (const [id, results] of Object.entries(samples)) {
      const game = GAMES[id];
      const { rows } = await db.query<{ i: number; pts: string; can_win: boolean }>(
        `select i::int, result_points($1, r) as pts, result_can_win($1, r) as can_win
         from jsonb_array_elements($2::jsonb) with ordinality as x(r, i)`,
        [id, JSON.stringify(results)],
      );
      for (const a of rows) {
        expect(a.can_win, `${id} canWin #${a.i}`).toBe(game.canWin(results[a.i - 1]));
        for (const b of rows) {
          const sql = Math.sign(Number(a.pts) - Number(b.pts));
          expect(sql, `${id} compare #${a.i} vs #${b.i}`).toBe(Math.sign(game.compare(results[a.i - 1], results[b.i - 1])));
        }
      }
    }
  });

  it("matches the site's rankings for finished rounds, current members only", async () => {
    const crew = await createCrew(ANN, "Ranked", "wordle");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    const days: Record<string, number | null>[] = [
      { [ANN]: 3, [BOB]: 4 },
      { [ANN]: 2, [BOB]: 2, [EVE]: 5 }, // Ann and Bob share the win
      { [BOB]: 3, [EVE]: null },
    ];
    const rounds = days.map((scores, i) => ({
      id: `00000000-0000-0000-0000-00000000010${i}`,
      closes_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      entries: Object.entries(scores).map(([user_id, g]) => ({ user_id, result: manualWordle(String(i + 1), g, false) })),
    }));
    await insertRounds(crew.id, rounds);
    // Today's open round doesn't count yet.
    await submitEntry(EVE, crew.id, solve(T, 1));

    const token = (await as<{ create_extension_token: string }>(ANN, "select create_extension_token()"))[0]
      .create_extension_token;
    await expect(as(null, "select * from extension_rankings('nope')")).rejects.toThrow(/not connected/);
    const rows = (
      await as<{ crew_name: string; user_id: string; is_me: boolean; played: number; wins: number; streak: number }>(
        null,
        "select * from extension_rankings($1)",
        [token],
      )
    ).filter((r) => r.crew_name === "Ranked");

    const { players } = crewStats(GAMES.wordle, rounds, [ANN, BOB, EVE]);
    expect(rows.map(({ user_id, played, wins, streak }) => ({ user_id, played, wins, streak }))).toEqual(
      players.map(({ userId, played, wins, streak }) => ({ user_id: userId, played, wins, streak })),
    );
    expect(rows.find((r) => r.is_me)?.user_id).toBe(ANN);

    // People who left drop out.
    await as(EVE, "select leave_crew($1)", [crew.id]);
    const after = await as<{ crew_name: string; user_id: string }>(null, "select * from extension_rankings($1)", [token]);
    expect(after.filter((r) => r.crew_name === "Ranked").map((r) => r.user_id)).toEqual([ANN, BOB]);
  });

  it("lists today's results for the popup, whichever browser sent them", async () => {
    const one = await createCrew(ANN, "Popup One", "wordle");
    const two = await createCrew(ANN, "Popup Two", "wordle");
    await submitEntry(ANN, one.id, solve(T, 3));
    await submitEntry(ANN, two.id, solve(T, 3));
    await as(BOB, "select join_crew($1)", [one.invite_code]);
    await submitEntry(BOB, one.id, solve(T, 2)); // someone else's

    const token = (await as<{ create_extension_token: string }>(ANN, "select create_extension_token()"))[0]
      .create_extension_token;
    type Row = { game: string; puzzle: string; result: { guesses: number }; crews: number };
    const results = (puzzles: object) =>
      as<Row>(null, "select * from extension_results($1, $2)", [token, JSON.stringify(puzzles)]);

    await expect(as(null, "select * from extension_results('nope', '{}')")).rejects.toThrow(/not connected/);
    await expect(results([])).rejects.toThrow(/Invalid puzzles/);

    const rows = await results({ wordle: T, connections: "1" });
    expect(rows.map(({ game, puzzle, result, crews }) => ({ game, puzzle, guesses: result.guesses, crews }))).toEqual([
      { game: "wordle", puzzle: T, guesses: 3, crews: 2 },
    ]);
    // Another day's puzzle isn't today's.
    expect(await results({ wordle: OLD })).toEqual([]);

    // Crews you've left don't count.
    await db.query("delete from crew_members where crew_id = $1 and user_id = $2", [two.id, ANN]);
    expect((await results({ wordle: T }))[0].crews).toBe(1);
  });
});

describe("duplicate display names within a crew", () => {
  const ZED = "00000000-0000-0000-0000-0000000000f1";
  const ZED2 = "00000000-0000-0000-0000-0000000000f2";
  let crew: CrewRow;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"Zed"}'), ($2, '{"display_name":"  zED "}')`,
      [ZED, ZED2],
    );
    crew = await createCrew(ZED, "Zed's Crew");
  });

  it("lets you join a crew where someone already has your name, and opening the link again is fine", async () => {
    await as(ZED2, "select join_crew($1)", [crew.invite_code]);
    await as(ZED2, "select join_crew($1)", [crew.invite_code]);
    const members = await as<{ user_id: string }>(ZED, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([ZED, ZED2].sort());
  });

  it("lets you rename yourself to a name someone in your crews already has", async () => {
    await as(ZED2, "update profiles set display_name = 'Zed' where id = $1", [ZED2]);
    const [p] = await as<{ display_name: string }>(ZED2, "select display_name from profiles where id = $1", [ZED2]);
    expect(p.display_name).toBe("Zed");
  });
});

describe("custom games", () => {
  beforeAll(() => clearCrewsOf(ANN));
  let crew: CrewRow;
  /** Today's custom-game "puzzle": days since 2020-01-01, by UTC date. */
  let D: string;
  type Custom = { id: string; name: string; score_type: string; higher_is_better: boolean; decimals: number };
  const create = (user: string, settings: object) =>
    as<Custom>(user, "select * from create_custom_game($1, $2)", [crew.id, JSON.stringify(settings)]);
  const enter = (user: string, game: string, result: object, source = "manual") =>
    as(user, "select submit_entry($1, $2, $3, null, $4)", [crew.id, game, JSON.stringify(result), source]);
  const stored = async (user: string, game: string) =>
    (
      await as<{ result: Record<string, unknown> }>(
        user,
        "select e.result from entries e join rounds r on r.id = e.round_id where e.user_id = $1 and r.game = $2",
        [user, game],
      )
    )[0]?.result;

  beforeAll(async () => {
    crew = await createCrew(ANN, "Customs");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    const { rows } = await db.query<{ d: number }>("select ((now() at time zone 'UTC')::date - date '2020-01-01') as d");
    D = String(rows[0].d);
  });

  it("lets only the owner create one, with valid settings, and starts playing it", async () => {
    const golf = { name: "Golf", color: "#3eb489", score_type: "points", higher_is_better: false };
    await expect(create(BOB, golf)).rejects.toThrow(/Only the crew owner/);
    await expect(create(ANN, { ...golf, name: "  " })).rejects.toThrow(/name/);
    await expect(create(ANN, { ...golf, color: "red" })).rejects.toThrow(/colour/);
    await expect(create(ANN, { ...golf, score_type: "vibes" })).rejects.toThrow(/score type/);
    await expect(create(ANN, { ...golf, url: "javascript:alert(1)" })).rejects.toThrow(/web address/);
    await expect(create(ANN, { ...golf, decimals: 5 })).rejects.toThrow(/Decimals/);

    const [g] = await create(ANN, { ...golf, unit: "strokes", url: "https://example.com/golf" });
    expect(g).toMatchObject({ name: "Golf", score_type: "points", higher_is_better: false, decimals: 0 });
    expect(await as(BOB, "select game from crew_games where crew_id = $1", [crew.id])).toEqual([{ game: `custom:${g.id}` }]);
    // Members can see it; other crews can't.
    expect(await as(BOB, "select name from custom_games where crew_id = $1", [crew.id])).toEqual([{ name: "Golf" }]);
    const other = await createCrew(BOB, "Elsewhere");
    expect(await as(BOB, "select * from custom_games where crew_id = $1", [other.id])).toEqual([]);
    await expect(as(BOB, "select set_crew_game($1, $2, true)", [other.id, `custom:${g.id}`])).rejects.toThrow(/Unsupported/);
  });

  it("takes typed-in points, lowest first when that's the setting", async () => {
    const [golf] = await as<{ id: string }>(ANN, "select id from custom_games where crew_id = $1 and name = 'Golf'", [crew.id]);
    const game = `custom:${golf.id}`;
    // Custom games take typed-in scores, not pastes.
    await expect(enter(BOB, game, { puzzle: D, value: 70 }, "paste")).rejects.toThrow(/Invalid source/);
    await expect(enter(BOB, game, { puzzle: String(Number(D) - 3), value: 70 })).rejects.toThrow(/day is over/);
    await expect(enter(BOB, game, { puzzle: D })).rejects.toThrow(/Enter a score/);
    await expect(enter(BOB, game, { puzzle: D, failed: true })).rejects.toThrow(/didn't finish/);
    await enter(BOB, game, { puzzle: D, value: 71.6 });
    expect(await stored(BOB, game)).toEqual({ puzzle: D, failed: false, value: 72 });
    const board = await as<{ source: string }>(ANN, "select * from get_round_board($1, $2, $3)", [crew.id, game, D]);
    expect(board.map((r) => r.source)).toEqual(["manual"]);
  });

  it("checks times and attempts, and allows a 'didn't finish' when the game does", async () => {
    const [race] = await create(ANN, { name: "Race", color: "#4ea8cc", score_type: "time", time_format: "m:ss.s" });
    expect(race.higher_is_better).toBe(false);
    await expect(enter(BOB, `custom:${race.id}`, { puzzle: D, value: 0 })).rejects.toThrow(/time between/);
    await enter(BOB, `custom:${race.id}`, { puzzle: D, value: 83.44 });
    expect(await stored(BOB, `custom:${race.id}`)).toMatchObject({ value: 83.4 });

    const [tries] = await create(ANN, {
      name: "Tries",
      color: "#b18ad8",
      score_type: "attempts",
      max_attempts: 6,
      allow_fail: true,
    });
    const game = `custom:${tries.id}`;
    await expect(enter(BOB, game, { puzzle: D, value: 7 })).rejects.toThrow(/1 to 6/);
    await expect(enter(BOB, game, { puzzle: D, value: 2.5 })).rejects.toThrow(/whole number/);
    await enter(BOB, game, { puzzle: D, failed: true, value: 3 });
    expect(await stored(BOB, game)).toEqual({ puzzle: D, failed: true });
  });

  it("keeps built-in games paste-only", async () => {
    await as(ANN, "select set_crew_game($1, 'wordle', true)", [crew.id]);
    await expect(as(BOB, "select submit_entry($1, 'wordle', $2, 'x', 'manual')", [crew.id, solve(T, 3)])).rejects.toThrow(
      /Invalid source/,
    );
  });

  it("locks scoring once someone has entered a score, but not the name or colour", async () => {
    const [golf] = await as<{ id: string }>(ANN, "select id from custom_games where crew_id = $1 and name = 'Golf'", [crew.id]);
    const base = { name: "Golf", color: "#3eb489", score_type: "points", higher_is_better: false };
    const update = (user: string, settings: object) =>
      as<Custom>(user, "select * from update_custom_game($1, $2)", [golf.id, JSON.stringify(settings)]);
    await expect(update(BOB, base)).rejects.toThrow(/Only the crew owner/);
    await expect(update(ANN, { ...base, higher_is_better: true })).rejects.toThrow(/Scoring can't change/);
    const [renamed] = await update(ANN, { ...base, name: "Mini Golf", color: "#ff5b1f", unit: "shots" });
    expect(renamed).toMatchObject({ name: "Mini Golf", higher_is_better: false });

    // A game nobody has played yet can still change its scoring.
    const [fresh] = await create(ANN, { name: "Fresh", color: "#aaaaaa", score_type: "points" });
    const [changed] = await as<Custom>(ANN, "select * from update_custom_game($1, $2)", [
      fresh.id,
      JSON.stringify({ name: "Fresh", color: "#aaaaaa", score_type: "time" }),
    ]);
    expect(changed.score_type).toBe("time");
  });

  it("caps a crew at 10 custom games", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from custom_games where crew_id = $1", [crew.id]);
    for (let i = rows[0].n; i < 10; i++) await create(ANN, { name: `G${i}`, color: "#aaaaaa", score_type: "points" });
    await expect(create(ANN, { name: "One more", color: "#aaaaaa", score_type: "points" })).rejects.toThrow(/up to 10/);
  });

  it("ranks custom games in the extension, by the game's own rules", async () => {
    const [golf] = await as<{ id: string }>(ANN, "select id from custom_games where crew_id = $1 and name = 'Mini Golf'", [crew.id]);
    const game = `custom:${golf.id}`;
    await enter(EVE, game, { puzzle: D, value: 65 });
    await enter(ANN, game, { puzzle: D, value: 80 });
    // Finish the day.
    await db.query("update rounds set closes_at = now() - interval '1 minute' where crew_id = $1 and game = $2", [crew.id, game]);
    const token = (await as<{ create_extension_token: string }>(ANN, "select create_extension_token()"))[0]
      .create_extension_token;
    const rows = (
      await as<{ crew_name: string; game: string; game_name: string; user_id: string; wins: number }>(
        null,
        "select * from extension_rankings($1)",
        [token],
      )
    ).filter((r) => r.crew_name === "Customs" && r.game === game);
    // Lowest wins: Eve (65) beats Bob (72) and Ann (80), who tie for the rest.
    expect(rows.map((r) => r.game_name)).toEqual(["Mini Golf", "Mini Golf", "Mini Golf"]);
    expect([rows[0].user_id, rows[0].wins]).toEqual([EVE, 1]);
    expect(rows.slice(1).map((r) => [r.user_id, r.wins]).sort()).toEqual([
      [ANN, 0],
      [BOB, 0],
    ]);
  });

  it("lets only the owner delete one, taking its scores and days with it", async () => {
    const [golf] = await as<{ id: string }>(ANN, "select id from custom_games where crew_id = $1 and name = 'Mini Golf'", [crew.id]);
    const game = `custom:${golf.id}`;
    const count = async (sql: string) => (await db.query<{ n: number }>(sql, [crew.id, game])).rows[0].n;
    expect(await count("select count(*)::int as n from rounds where crew_id = $1 and game = $2")).toBeGreaterThan(0);

    await expect(as(BOB, "select delete_custom_game($1)", [golf.id])).rejects.toThrow(/Only the crew owner/);
    await as(ANN, "select delete_custom_game($1)", [golf.id]);

    expect(await as(ANN, "select id from custom_games where id = $1", [golf.id])).toEqual([]);
    expect(await count("select count(*)::int as n from crew_games where crew_id = $1 and game = $2")).toBe(0);
    expect(await count("select count(*)::int as n from rounds where crew_id = $1 and game = $2")).toBe(0);
    expect(
      await count(
        "select count(*)::int as n from entries e join rounds r on r.id = e.round_id where r.crew_id = $1 and r.game = $2",
      ),
    ).toBe(0);
    // A deleted game can't be played any more, and there's room for a new one.
    await expect(enter(ANN, game, { puzzle: D, value: 1 })).rejects.toThrow();
    await create(ANN, { name: "Replacement", color: "#aaaaaa", score_type: "points" });
  });
});

describe("guests", () => {
  beforeAll(() => clearCrewsOf(ANN));
  const GUEST = "00000000-0000-0000-0000-0000000000a1";
  const HOST = "00000000-0000-0000-0000-0000000000a2";
  let crew: CrewRow;
  let hosted: CrewRow;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, is_anonymous) values
       ($1, '{"display_name":"Gus"}', true), ($2, '{"display_name":"Hal"}', true)`,
      [GUEST, HOST],
    );
    crew = await createCrew(ANN, "Has Guests", "wordle");
    await as(GUEST, "select join_crew($1)", [crew.invite_code]);
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    await submitEntry(GUEST, crew.id, solve(T, 3));
    await submitEntry(BOB, crew.id, solve(T, 4));
    // A guest who owns a crew (made before guests were stopped from creating them).
    await db.query("update auth.users set is_anonymous = false where id = $1", [HOST]);
    hosted = await createCrew(HOST, "Guest Owned", "wordle");
    await db.query("update auth.users set is_anonymous = true where id = $1", [HOST]);
    await submitEntry(HOST, hosted.id, solve(T, 2));
  });

  it("marks guests on their profile, for everyone to see", async () => {
    const rows = await as<{ id: string; is_guest: boolean }>(
      ANN,
      "select id, is_guest from profiles where id in ($1, $2) order by id",
      [GUEST, BOB],
    );
    expect(rows).toEqual([
      { id: BOB, is_guest: false },
      { id: GUEST, is_guest: true },
    ]);
  });

  it("marks guests on the scoreboard", async () => {
    const rows = await as<{ user_id: string; is_guest: boolean }>(
      ANN,
      "select user_id, is_guest from get_round_board($1, 'wordle', $2)",
      [crew.id, T],
    );
    expect(rows).toEqual([
      { user_id: GUEST, is_guest: true },
      { user_id: BOB, is_guest: false },
    ]);
  });

  it("keeps guests in their crews from one day to the next", async () => {
    await db.query("update crew_members set joined_at = now() - interval '3 days' where user_id in ($1, $2)", [GUEST, HOST]);
    expect(await db.query("select remove_expired_guests() as n").then((r) => r.rows[0])).toEqual({ n: 0 });
    const members = await as<{ user_id: string }>(ANN, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([ANN, BOB, GUEST].sort());
    // A crew a guest made back when they could stays, with their score.
    expect((await board(HOST, hosted.id, T)).map((r) => r.user_id)).toEqual([HOST]);
    // Nobody can trigger the cleanup through the API.
    await expect(as(ANN, "select remove_expired_guests()")).rejects.toThrow(/permission denied/);
  });

  it("stops counting someone as a guest once they link Google", async () => {
    await db.query("update auth.users set is_anonymous = false where id = $1", [GUEST]);
    const [row] = await as<{ is_guest: boolean }>(ANN, "select is_guest from profiles where id = $1", [GUEST]);
    expect(row.is_guest).toBe(false);
  });
});

describe("guest crews", () => {
  const MAKER = "00000000-0000-0000-0000-0000000002a1";

  beforeAll(async () => {
    await db.query(`insert into auth.users (id, raw_user_meta_data, is_anonymous) values ($1, '{"display_name":"Maker"}', true)`, [
      MAKER,
    ]);
  });

  it("doesn't let guests make a crew", async () => {
    await expect(as(MAKER, "select create_crew('Guest Night', 'UTC')")).rejects.toThrow(/Sign in with Google to create a crew/);
  });

  it("lets them once they link Google", async () => {
    await db.query("update auth.users set is_anonymous = false where id = $1", [MAKER]);
    const [c] = await as<CrewRow>(MAKER, "select * from create_crew('Kept Crew', 'UTC')");
    expect(c).not.toHaveProperty("guest_expires_at");
    await db.query("select remove_expired_guests()");
    expect((await db.query("select 1 from crews where id = $1", [c.id])).rows).toHaveLength(1);
  });
});

describe("idle guests", () => {
  const id = (n: number) => `00000000-0000-0000-0000-0000000004${String(n).padStart(2, "0")}`;
  const [IDLE_OLD, IDLE_NEW, MEMBER, SCORED] = [id(1), id(2), id(3), id(4)];
  const exists = async (user: string) =>
    (await db.query("select 1 from auth.users where id = $1", [user])).rows.length > 0;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, is_anonymous) values
       ($1, '{"display_name":"Idle Old"}', true), ($2, '{"display_name":"Idle New"}', true),
       ($3, '{"display_name":"Still In"}', true), ($4, '{"display_name":"Scored"}', true)`,
      [IDLE_OLD, IDLE_NEW, MEMBER, SCORED],
    );
    const c = await createCrew(BOB, "Idle Check", "wordle");
    await as(MEMBER, "select join_crew($1)", [c.invite_code]);
    await as(SCORED, "select join_crew($1)", [c.invite_code]);
    // A score on a finished day, then they left: the score stays, and so must they.
    await insertRounds(c.id, [
      {
        id: "00000000-0000-0000-0000-000000000410",
        closes_at: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        entries: [{ user_id: SCORED, result: manualWordle("1", 4, false) }],
      },
    ]);
    await as(SCORED, "select leave_crew($1)", [c.id]);
    // All but one were made over a day ago.
    await db.query("update profiles set created_at = now() - interval '2 days' where id in ($1, $2, $3)", [
      IDLE_OLD,
      MEMBER,
      SCORED,
    ]);
  });

  it("deletes guest accounts over a day old with nothing attached, and keeps the rest", async () => {
    await db.query("select remove_expired_guests()");
    expect(await exists(IDLE_OLD)).toBe(false);
    // Made today: kept for now.
    expect(await exists(IDLE_NEW)).toBe(true);
    // In a crew: kept.
    expect(await exists(MEMBER)).toBe(true);
    // Has a score in a crew's history: kept, so the score stays.
    expect(await exists(SCORED)).toBe(true);
  });
});

describe("inactive guests", () => {
  const id = (n: number) => `00000000-0000-0000-0000-0000000007${String(n).padStart(2, "0")}`;
  const [QUIET, ACTIVE, FRESH, OWNS, REGULAR] = [id(1), id(2), id(3), id(4), id(5)];
  let crew: CrewRow;
  const inCrew = async (user: string) =>
    (await db.query("select 1 from crew_members where crew_id = $1 and user_id = $2", [crew.id, user])).rows.length > 0;
  const entryCount = async (user: string) =>
    (await db.query<{ n: number }>("select count(*)::int as n from entries where user_id = $1", [user])).rows[0].n;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, is_anonymous) values
       ($1, '{"display_name":"Quiet"}', true), ($2, '{"display_name":"Active"}', true),
       ($3, '{"display_name":"Fresh"}', true), ($4, '{"display_name":"Owns"}', true),
       ($5, '{"display_name":"Regular"}', false)`,
      [QUIET, ACTIVE, FRESH, OWNS, REGULAR],
    );
    // A regular player's crew (the shared test players are in plenty already).
    crew = await createCrew(REGULAR, "Quiet Check", "wordle");
    for (const u of [QUIET, ACTIVE, FRESH]) await as(u, "select join_crew($1)", [crew.invite_code]);
    // A guest who owns a crew, from before guests were stopped making them.
    await db.query("update auth.users set is_anonymous = false where id = $1", [OWNS]);
    await createCrew(OWNS, "Guest Owned 2");
    await db.query("update auth.users set is_anonymous = true where id = $1", [OWNS]);
    // A finished day the quiet guest played, and today, which they also played.
    await insertRounds(crew.id, [
      {
        id: "00000000-0000-0000-0000-000000000710",
        closes_at: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        entries: [{ user_id: QUIET, result: manualWordle("1", 4, false) }],
      },
    ]);
    await submitEntry(QUIET, crew.id, solve(T, 3));
    await submitEntry(ACTIVE, crew.id, solve(T, 4));
    // Everyone but Fresh made their account and joined 3 days ago...
    await db.query("update profiles set created_at = now() - interval '3 days' where id = any($1)", [[QUIET, ACTIVE, OWNS, REGULAR]]);
    await db.query("update crew_members set joined_at = now() - interval '3 days' where user_id = any($1)", [[QUIET, ACTIVE, OWNS, REGULAR]]);
    // ...and the quiet guest's last score was 3 days ago too. Active scored just now.
    await db.query("update entries set submitted_at = now() - interval '3 days' where user_id = $1", [QUIET]);
  });

  it("takes guests with nothing done in 48 hours out of their crews, keeping finished days", async () => {
    await db.query("select remove_expired_guests()");
    expect(await inCrew(QUIET)).toBe(false);
    // Today's score is gone; the finished day stays for the archive, and so does the account.
    expect(await entryCount(QUIET)).toBe(1);
    expect((await board(REGULAR, crew.id, T)).map((r) => r.user_id)).toEqual([ACTIVE]);
    expect((await db.query("select 1 from auth.users where id = $1", [QUIET])).rows).toHaveLength(1);
  });

  it("leaves active and new guests, guests who own a crew, and regular players", async () => {
    expect(await inCrew(ACTIVE)).toBe(true);
    expect(await inCrew(FRESH)).toBe(true);
    expect(await inCrew(REGULAR)).toBe(true);
    expect((await db.query("select 1 from crew_members where user_id = $1", [OWNS])).rows).toHaveLength(1);
  });

  it("lets a removed guest rejoin with the invite link", async () => {
    await as(QUIET, "select join_crew($1)", [crew.invite_code]);
    expect(await inCrew(QUIET)).toBe(true);
  });
});

describe("crew limits", () => {
  const id = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
  const GUEST = id(99);

  beforeAll(async () => {
    const users = Array.from({ length: 12 }, (_, i) => `('${id(i)}', '{"display_name":"Limit ${i}"}', false)`);
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, is_anonymous) values ${users.join(", ")},
       ('${GUEST}', '{"display_name":"Visitor"}', true)`,
    );
  });

  it("holds at most 10 players", async () => {
    const c = await createCrew(id(0), "Ten Max", "wordle");
    for (let i = 1; i < 10; i++) await as(id(i), "select join_crew($1)", [c.invite_code]);
    await expect(as(id(10), "select join_crew($1)", [c.invite_code])).rejects.toThrow(/full/);
    // Members opening the link again are fine.
    await as(id(9), "select join_crew($1)", [c.invite_code]);
  });

  it("lets the owner turn off guest joins", async () => {
    const c = await createCrew(id(11), "No Guests", "wordle");
    await as(id(11), "select update_crew_settings($1, p_allow_guests => false)", [c.id]);
    await expect(as(GUEST, "select join_crew($1)", [c.invite_code])).rejects.toThrow(/doesn't take guests/);
    await as(id(10), "select join_crew($1)", [c.invite_code]);
    await as(id(11), "select update_crew_settings($1, p_allow_guests => true)", [c.id]);
    await as(GUEST, "select join_crew($1)", [c.invite_code]);
  });

  it("keeps new crew names to 16 characters", async () => {
    await expect(as(id(3), "select create_crew($1, 'UTC')", ["x".repeat(17)])).rejects.toThrow(/1 to 16/);
    await expect(as(id(3), "select create_crew('   ', 'UTC')")).rejects.toThrow(/1 to 16/);
    await createCrew(id(3), "Sixteen Chars Ok");
  });

  it("keeps each account to 4 crews, owned and joined together, and checks that first when joining", async () => {
    const [user, host] = [id(60), id(61)];
    await db.query(
      `insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"Four Max"}'), ($2, '{"display_name":"Host 4"}')`,
      [user, host],
    );
    const mine = [];
    for (let i = 0; i < 3; i++) mine.push(await createCrew(user, `Crew ${i}`));
    const joined = await createCrew(host, "Joined One");
    const another = await createCrew(host, "Another One");
    await as(user, "select join_crew($1)", [joined.invite_code]);

    // In 4: no making or joining another.
    await expect(createCrew(user, "One Too Many")).rejects.toThrow(/in 4 crews/);
    await expect(as(user, "select join_crew($1)", [another.invite_code])).rejects.toThrow(/in 4 crews.*Leave one/);
    // The limit comes before anything about the crew itself.
    await expect(as(user, "select join_crew('nosuchcrew')")).rejects.toThrow(/in 4 crews/);
    // Opening a crew you're already in is fine.
    await as(user, "select join_crew($1)", [mine[0].invite_code]);
    await as(user, "select join_crew($1)", [joined.invite_code]);

    // Approval checks it too: asking while in 4 is refused, and so is being let in after filling up.
    await as(host, "select update_crew_settings($1, p_require_approval => true)", [another.id]);
    await expect(as(user, "select join_crew($1)", [another.invite_code])).rejects.toThrow(/in 4 crews/);
    await as(user, "select leave_crew($1)", [joined.id]);
    await as(user, "select join_crew($1)", [another.invite_code]); // asks
    await as(host, "select update_crew_settings($1, p_require_approval => false)", [joined.id]);
    await as(user, "select join_crew($1)", [joined.invite_code]); // back to 4
    await expect(as(host, "select answer_join_request($1, $2, true)", [another.id, user])).rejects.toThrow(
      /already in 4 crews/,
    );

    // Leaving or deleting one makes room.
    await as(user, "select delete_crew($1)", [mine[1].id]);
    await as(host, "select answer_join_request($1, $2, true)", [another.id, user]);
    await as(user, "select leave_crew($1)", [joined.id]);
    await createCrew(user, "Room Again");
  });

  it("keeps display names to 16 characters, without breaking older long names", async () => {
    await expect(as(id(1), "update profiles set display_name = $2 where id = $1", [id(1), "x".repeat(17)])).rejects.toThrow(
      /16 characters/,
    );
    await as(id(1), "update profiles set display_name = $2 where id = $1", [id(1), "Sixteen Chars Ok"]);
    // A name from before the limit stays, and the profile can still be updated.
    await db.exec("alter table profiles disable trigger profiles_display_name_length");
    await db.query("update profiles set display_name = 'An Older Long Name Here' where id = $1", [id(2)]);
    await db.exec("alter table profiles enable trigger profiles_display_name_length");
    await db.query("update profiles set is_guest = false where id = $1", [id(2)]);
    // New accounts get a name cut to 16.
    await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"full_name":"Bartholomew Montgomery"}')`, [
      id(50),
    ]);
    const [p] = await as<{ display_name: string }>(ANN, "select display_name from profiles where id = $1", [id(50)]);
    expect(p.display_name).toBe("Bartholomew Mont");
  });

  it("doesn't let guests suggest games, but lets them report problems", async () => {
    await expect(as(GUEST, "select send_feedback('game', null, 'Strands')")).rejects.toThrow(/Sign in with Google/);
    await as(GUEST, "select send_feedback('problem', 'Scores missing on Opera')");
    await db.query("delete from game_suggestions where user_id = $1", [GUEST]);
  });
});

describe("removing a member's stats", () => {
  // Their own player: the shared ones are in plenty of crews by now.
  const SAM = "00000000-0000-0000-0000-0000000005a1";
  beforeAll(async () => {
    await clearCrewsOf(ANN);
    await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"Sam"}')`, [SAM]);
  });
  const past = (id: string, user: string) => ({
    id,
    closes_at: "2020-01-02T00:00:00Z",
    entries: [{ user_id: user, result: JSON.parse(solve(OLD, 3)) }],
  });
  const pastEntries = (crew: string, user: string) =>
    db.query<{ n: number }>(
      "select count(*)::int as n from entries e join rounds r on r.id = e.round_id where r.crew_id = $1 and e.user_id = $2",
      [crew, user],
    ).then((r) => r.rows[0].n);

  it("keeps finished results by default", async () => {
    const crew = await createCrew(ANN, "Keep Stats", "wordle");
    await as(SAM, "select join_crew($1)", [crew.invite_code]);
    await insertRounds(crew.id, [past("00000000-0000-0000-0000-0000000000f1", SAM)]);
    await submitEntry(SAM, crew.id, solve(T, 4));
    await as(ANN, "select remove_crew_member($1, $2)", [crew.id, SAM]);
    expect(await pastEntries(crew.id, SAM)).toBe(1);
  });

  it("deletes every result in the crew with p_wipe, and none elsewhere", async () => {
    const crew = await createCrew(ANN, "Wipe Stats", "wordle");
    const other = await createCrew(ANN, "Other Crew", "wordle");
    for (const c of [crew, other]) await as(SAM, "select join_crew($1)", [c.invite_code]);
    await insertRounds(crew.id, [past("00000000-0000-0000-0000-0000000000f2", SAM)]);
    await insertRounds(other.id, [past("00000000-0000-0000-0000-0000000000f3", SAM)]);
    await submitEntry(SAM, crew.id, solve(T, 4));
    await as(ANN, "select remove_crew_member($1, $2, true)", [crew.id, SAM]);
    expect(await pastEntries(crew.id, SAM)).toBe(0);
    expect(await pastEntries(other.id, SAM)).toBe(1);
  });
});

describe("transferring a crew", () => {
  const [OWNER, HEIR, VISITOR, OUTSIDER] = [
    "00000000-0000-0000-0000-0000000006a1",
    "00000000-0000-0000-0000-0000000006a2",
    "00000000-0000-0000-0000-0000000006a3",
    "00000000-0000-0000-0000-0000000006a4",
  ];
  let crew: CrewRow;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, is_anonymous) values
       ($1, '{"display_name":"Olga"}', false), ($2, '{"display_name":"Hank"}', false),
       ($3, '{"display_name":"Vera"}', true), ($4, '{"display_name":"Otto"}', false)`,
      [OWNER, HEIR, VISITOR, OUTSIDER],
    );
    crew = await createCrew(OWNER, "Handover", "wordle");
    await as(HEIR, "select join_crew($1)", [crew.invite_code]);
    await as(VISITOR, "select join_crew($1)", [crew.invite_code]);
  });

  it("only the owner can, and only to a member who isn't a guest", async () => {
    await expect(as(HEIR, "select transfer_crew($1, $2)", [crew.id, HEIR])).rejects.toThrow(/Only the crew owner/);
    await expect(as(OWNER, "select transfer_crew($1, $2)", [crew.id, OWNER])).rejects.toThrow(/already own/);
    await expect(as(OWNER, "select transfer_crew($1, $2)", [crew.id, OUTSIDER])).rejects.toThrow(/has to be in the crew/);
    await expect(as(OWNER, "select transfer_crew($1, $2)", [crew.id, VISITOR])).rejects.toThrow(/Guests can't own/);
  });

  it("hands over every owner power, and the old owner stays as a member", async () => {
    const [moved] = await as<{ created_by: string }>(OWNER, "select * from transfer_crew($1, $2)", [crew.id, HEIR]);
    expect(moved.created_by).toBe(HEIR);
    // The new owner runs it now; the old one can't.
    await as(HEIR, "select update_crew_settings($1, p_name => 'Handed Over')", [crew.id]);
    await expect(as(OWNER, "select update_crew_settings($1, p_name => 'Mine again')", [crew.id])).rejects.toThrow(
      /Only the crew owner/,
    );
    await expect(as(OWNER, "select transfer_crew($1, $2)", [crew.id, OWNER])).rejects.toThrow(/Only the crew owner/);
    const members = await as<{ user_id: string }>(HEIR, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([OWNER, HEIR, VISITOR].sort());
    // So the old owner can leave, and the new one can remove people.
    await as(OWNER, "select leave_crew($1)", [crew.id]);
    await as(HEIR, "select remove_crew_member($1, $2)", [crew.id, VISITOR]);
  });
});

describe("game order", () => {
  const [OWNER, MEMBER, OUTSIDER] = [
    "00000000-0000-0000-0000-0000000007a1",
    "00000000-0000-0000-0000-0000000007a2",
    "00000000-0000-0000-0000-0000000007a3",
  ];
  let crew: CrewRow;
  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data) values
       ($1, '{"display_name":"Orla"}'), ($2, '{"display_name":"Milo"}'), ($3, '{"display_name":"Otto"}')`,
      [OWNER, MEMBER, OUTSIDER],
    );
    crew = await createCrew(OWNER, "Order Crew", "wordle", "connections");
    await as(MEMBER, "select join_crew($1)", [crew.invite_code]);
  });
  const orderOf = (user: string) =>
    as<{ games: string[] }>(user, "select games from game_orders where crew_id = $1", [crew.id]).then((r) => r[0]?.games ?? null);

  it("saves and replaces your own order", async () => {
    expect(await orderOf(MEMBER)).toBeNull();
    await as(MEMBER, "select set_game_order($1, array['connections', 'wordle'])", [crew.id]);
    expect(await orderOf(MEMBER)).toEqual(["connections", "wordle"]);
    await as(MEMBER, "select set_game_order($1, array['wordle', 'connections'])", [crew.id]);
    expect(await orderOf(MEMBER)).toEqual(["wordle", "connections"]);
  });

  it("keeps it private to you", async () => {
    await as(OWNER, "select set_game_order($1, array['connections'])", [crew.id]);
    expect(await orderOf(OWNER)).toEqual(["connections"]);
    // Each member reads only their own row.
    expect(await as(OWNER, "select user_id from game_orders")).toEqual([{ user_id: OWNER }]);
    expect(await as(OUTSIDER, "select * from game_orders")).toEqual([]);
    await expect(as(null, "select * from game_orders")).rejects.toThrow(/permission denied/);
  });

  it("only takes orders from crew members, and sane ones", async () => {
    await expect(as(OUTSIDER, "select set_game_order($1, array['wordle'])", [crew.id])).rejects.toThrow(/Crew not found/);
    await expect(
      as(MEMBER, "select set_game_order($1, array_fill('wordle'::text, array[101]))", [crew.id]),
    ).rejects.toThrow(/Invalid game order/);
    await expect(as(MEMBER, "select set_game_order($1, array[repeat('x', 101)])", [crew.id])).rejects.toThrow(
      /Invalid game order/,
    );
    await expect(as(MEMBER, "insert into game_orders (crew_id, user_id) values ($1, $2)", [crew.id, MEMBER])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("is dropped when you leave the crew", async () => {
    await as(MEMBER, "select leave_crew($1)", [crew.id]);
    expect(await orderOf(MEMBER)).toBeNull();
  });
});

describe("function permissions", () => {
  beforeAll(() => clearCrewsOf(ANN));
  // Everything the site, the extension and RLS call. Every other function is
  // internal: callable only from these, never through the API.
  const SITE = [
    "answer_join_request",
    "can_see_entry",
    "create_crew",
    "create_custom_game",
    "create_extension_token",
    "delete_crew",
    "delete_custom_game",
    "extension_rankings",
    "extension_results",
    "extension_submit",
    "get_round_board",
    "is_crew_member",
    "join_crew",
    "leave_crew",
    "remove_crew_member",
    "reset_rankings",
    "revoke_extension_tokens",
    "send_feedback",
    "set_crew_game",
    "set_game_order",
    "submit_entry",
    "transfer_crew",
    "update_crew_settings",
    "update_custom_game",
    "void_entry",
  ];
  const EXTENSION = ["extension_rankings", "extension_results", "extension_submit"];

  const callable = async (role: string) =>
    (
      await db.query<{ proname: string }>(
        `select distinct proname from pg_proc
         where pronamespace = 'public'::regnamespace and prokind = 'f'
           and has_function_privilege($1, oid, 'execute')
         order by proname`,
        [role],
      )
    ).rows.map((r) => r.proname);

  it("exposes only the site's functions to signed-in users", async () => {
    expect(await callable("authenticated")).toEqual(SITE);
  });

  it("exposes only the extension's functions to the public key", async () => {
    expect(await callable("anon")).toEqual(EXTENSION);
  });

  it("doesn't let anyone record a score for someone else", async () => {
    const c = await createCrew(ANN, "Impostors", "wordle");
    await as(BOB, "select join_crew($1)", [c.invite_code]);
    await expect(
      as(BOB, "select record_entry($1, $2, 'wordle', $3, 'x', 'paste')", [ANN, c.id, solve(T, 6)]),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps future functions private until a migration grants them", async () => {
    await db.exec("create function public.zz_new_helper() returns int language sql as 'select 1'");
    try {
      expect(await callable("authenticated")).not.toContain("zz_new_helper");
      expect(await callable("anon")).not.toContain("zz_new_helper");
    } finally {
      await db.exec("drop function public.zz_new_helper()");
    }
  });
});

describe("feedback", () => {
  const send = (user: string | null, ...args: unknown[]) =>
    as(user, `select send_feedback(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args);

  it("accepts game suggestions from signed-in users and keeps them private", async () => {
    await send(BOB, "game", "pls", "  Strands ", "https://nytimes.com/games/strands");
    await expect(send(null, "game", null, "Nope")).rejects.toThrow(/permission denied/);
    await expect(send(BOB, "game", null, "  ")).rejects.toThrow(/name/);
    await expect(send(BOB, "game", null, "X", "javascript:alert(1)")).rejects.toThrow(/web address/);
    await expect(send(BOB, "bogus", "hi")).rejects.toThrow(/what this is about/);

    // Nobody can read them through the API, not even the author.
    await expect(as(BOB, "select * from game_suggestions")).rejects.toThrow(/permission denied/);
    await expect(as(ANN, "select * from game_suggestions")).rejects.toThrow(/permission denied/);

    const { rows } = await db.query("select kind, name, user_id, notes, email from game_suggestions");
    expect(rows).toEqual([{ kind: "game", name: "Strands", user_id: BOB, notes: "pls", email: null }]);
    await db.query("delete from game_suggestions");
  });

  it("takes problem reports with a message and the browser details, and nothing else", async () => {
    await expect(send(ANN, "problem", "  ")).rejects.toThrow(/Write a message/);
    const details = { browser: "Mozilla/5.0 OPR/120", extension: "0.5.8", page: "/crew/ABC", password: "nope" };
    await send(ANN, "problem", "Scores missing", "ignored", "https://ignored.example", null, JSON.stringify(details));
    await db.query("update game_suggestions set created_at = now() - interval '3 minutes'");
    await send(ANN, "other", "Love it", null, null, null, JSON.stringify(details));
    const { rows } = await db.query("select kind, name, url, notes, details from game_suggestions order by created_at");
    expect(rows).toEqual([
      {
        kind: "problem",
        name: null,
        url: null,
        notes: "Scores missing",
        details: { browser: "Mozilla/5.0 OPR/120", extension: "0.5.8", page: "/crew/ABC" },
      },
      // Only problem reports keep the details.
      { kind: "other", name: null, url: null, notes: "Love it", details: null },
    ]);
    await db.query("delete from game_suggestions");
  });

  it("takes an optional contact email and checks it looks like one", async () => {
    await expect(send(ANN, "game", null, "X", null, "not an email")).rejects.toThrow(/email/);
    await expect(send(ANN, "game", null, "X", null, "a@b")).rejects.toThrow(/email/);
    await send(ANN, "game", null, "Spelling Bee", null, "  Ann@Example.COM ");
    const { rows } = await db.query<{ email: string }>("select email from game_suggestions where user_id = $1", [ANN]);
    expect(rows).toEqual([{ email: "ann@example.com" }]);
    await db.query("delete from game_suggestions where user_id = $1", [ANN]);
  });

  it("makes each user wait two minutes between messages", async () => {
    await send(ANN, "other", "First");
    await expect(send(ANN, "problem", "Second")).rejects.toThrow(/couple of minutes/);

    await db.query("update game_suggestions set created_at = now() - interval '3 minutes' where user_id = $1", [ANN]);
    await send(ANN, "problem", "Second");
  });

  it("limits each user to five a day", async () => {
    for (let i = 0; i < 5; i++) {
      await send(EVE, "game", null, `Game ${i}`);
      // Step past the cooldown, keeping every row inside the last day.
      await db.query(
        "update game_suggestions set created_at = created_at - interval '3 minutes' where user_id = $1",
        [EVE],
      );
    }
    await expect(send(EVE, "other", "One more")).rejects.toThrow(/tomorrow/);
  });
});

describe("crew rules", () => {
  const id = (n: number) => `00000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
  const [OWNER, ASKER, OTHER] = [id(1), id(2), id(3)];

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data) values
       ($1, '{"display_name":"Rule Owner"}'), ($2, '{"display_name":"Asker"}'), ($3, '{"display_name":"Other"}')`,
      [OWNER, ASKER, OTHER],
    );
  });

  it("with approval on, the invite link asks to join, and the owner decides", async () => {
    const c = await createCrew(OWNER, "Ask First", "wordle");
    await as(OWNER, "select update_crew_settings($1, p_require_approval => true)", [c.id]);

    // Asking: not a member yet, and can't see the crew.
    const [asked] = await as<{ name: string }>(ASKER, "select * from join_crew($1)", [c.invite_code]);
    expect(asked.name).toBe("Ask First");
    expect(await as(ASKER, "select 1 from crew_members where crew_id = $1", [c.id])).toEqual([]);
    expect(await as(ASKER, "select 1 from crews where id = $1", [c.id])).toEqual([]);
    // Asking again is fine.
    await as(ASKER, "select join_crew($1)", [c.invite_code]);

    // The owner sees the request; others don't.
    const requests = await as<{ user_id: string }>(OWNER, "select user_id from crew_join_requests where crew_id = $1", [
      c.id,
    ]);
    expect(requests.map((r) => r.user_id)).toEqual([ASKER]);
    expect(await as(OTHER, "select 1 from crew_join_requests where crew_id = $1", [c.id])).toEqual([]);
    await expect(as(OTHER, "select answer_join_request($1, $2, true)", [c.id, ASKER])).rejects.toThrow(
      /Only the crew owner/,
    );

    // Approved: in, and the request is gone.
    await as(OWNER, "select answer_join_request($1, $2, true)", [c.id, ASKER]);
    expect(
      await as(ASKER, "select 1 from crew_members where crew_id = $1 and user_id = $2", [c.id, ASKER]),
    ).toHaveLength(1);
    expect(await as(OWNER, "select 1 from crew_join_requests where crew_id = $1", [c.id])).toEqual([]);

    // Declined: told so when opening the link again, and not asked twice.
    await as(OTHER, "select join_crew($1)", [c.invite_code]);
    await as(OWNER, "select answer_join_request($1, $2, false)", [c.id, OTHER]);
    await expect(as(OTHER, "select join_crew($1)", [c.invite_code])).rejects.toThrow(/approve your request/);
    await expect(as(OWNER, "select answer_join_request($1, $2, true)", [c.id, OTHER])).rejects.toThrow(/No request/);
  });

  it("ranks by win rate when the crew says so, in the extension too", async () => {
    const c = await createCrew(OWNER, "By Rate", "wordle");
    await as(ASKER, "select join_crew($1)", [c.invite_code]);
    // The owner plays once and wins; Asker plays every day and wins twice.
    const days: Record<string, number>[] = [{ [OWNER]: 2, [ASKER]: 3 }, { [ASKER]: 3 }, { [ASKER]: 2 }];
    const rounds = days.map((scores, i) => ({
      id: `00000000-0000-0000-0000-00000000030${i}`,
      closes_at: new Date(Date.UTC(2026, 1, i + 1)).toISOString(),
      entries: Object.entries(scores).map(([user_id, g]) => ({
        user_id,
        result: manualWordle(String(i + 1), g, false),
      })),
    }));
    await insertRounds(c.id, rounds);
    const token = (await as<{ create_extension_token: string }>(OWNER, "select create_extension_token()"))[0]
      .create_extension_token;
    const extensionOrder = async () =>
      (await as<{ crew_name: string; user_id: string }>(null, "select * from extension_rankings($1)", [token]))
        .filter((r) => r.crew_name === "By Rate")
        .map((r) => r.user_id);
    const siteOrder = (byWinRate: boolean) =>
      crewStats(GAMES.wordle, rounds, [OWNER, ASKER], { byWinRate }).players.map((p) => p.userId);

    // Default: most wins first.
    expect(await extensionOrder()).toEqual([ASKER, OWNER]);
    expect(siteOrder(false)).toEqual([ASKER, OWNER]);
    // By win rate: the owner's 1 from 1 beats 2 from 3.
    await as(OWNER, "select update_crew_settings($1, p_rank_by_win_rate => true)", [c.id]);
    expect(await extensionOrder()).toEqual([OWNER, ASKER]);
    expect(siteOrder(true)).toEqual([OWNER, ASKER]);
  });

  it("lets only the owner reset the rankings, which keeps the days but stops counting them", async () => {
    const c = await createCrew(OWNER, "Fresh Start", "wordle");
    await as(ASKER, "select join_crew($1)", [c.invite_code]);
    await insertRounds(c.id, [
      {
        id: "00000000-0000-0000-0000-000000000310",
        closes_at: new Date(Date.UTC(2026, 1, 1)).toISOString(),
        entries: [{ user_id: ASKER, result: manualWordle("1", 3, false) }],
      },
    ]);
    const token = (await as<{ create_extension_token: string }>(OWNER, "select create_extension_token()"))[0]
      .create_extension_token;
    const ranked = async () =>
      (await as<{ crew_name: string }>(null, "select * from extension_rankings($1)", [token])).filter(
        (r) => r.crew_name === "Fresh Start",
      ).length;
    expect(await ranked()).toBe(1);

    await expect(as(ASKER, "select reset_rankings($1)", [c.id])).rejects.toThrow(/Only the crew owner/);
    const [reset] = await as<{ rankings_reset_at: string | null }>(OWNER, "select * from reset_rankings($1)", [c.id]);
    expect(reset.rankings_reset_at).not.toBeNull();
    expect(await ranked()).toBe(0);
    // The day itself is still there, for the archive.
    const kept = await db.query("select 1 from rounds where crew_id = $1", [c.id]);
    expect(kept.rows).toHaveLength(1);
  });
});

describe("re-running migrations", () => {
  it("can run 0018 and 0019 again on a database that already has them", async () => {
    await db.exec(MIGRATIONS.find((sql) => sql.includes("Limits that keep crews small"))!);
    await db.exec(MIGRATIONS.find((sql) => sql.includes("More rules for crew owners"))!);
    // Still working afterwards.
    const c = await createCrew(BOB, "Rerun Check");
    await as(BOB, "select update_crew_settings($1, p_allow_guests => false)", [c.id]);
  });
});
