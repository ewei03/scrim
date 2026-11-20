// Runs the real migrations in an in-memory Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then exercises the RPCs and RLS rules
// as different users.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, MIGRATIONS_DIR), "utf8"));

const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
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
const solve = (puzzle: string, guesses: number, rows?: string) =>
  `{"puzzle":"${puzzle}","solved":true,"guesses":${guesses},"hard":false${rows ? `,"grid":${rows}` : ""}}`;

let crewId: string;
let lobbyId: string;
let lobbyCode: string;
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

const createLobby = (user: string, crew: string, puzzle: string, extra = "") =>
  as<{ id: string; invite_code: string }>(
    user,
    `select * from create_lobby($1, 'wordle', $2, now() + interval '1 day'${extra})`,
    [crew, puzzle],
  );

const createCrew = async (user: string, name: string) =>
  (await as<{ id: string; invite_code: string }>(user, "select * from create_crew($1)", [name]))[0];

describe("schema", () => {
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

  it("creates a crew and a lobby, deduplicating lobbies per puzzle", async () => {
    crewId = (await createCrew(ANN, "Breakfast Club")).id;
    const [a] = await createLobby(ANN, crewId, T);
    const [b] = await createLobby(ANN, crewId, T);
    expect(b.id).toBe(a.id);
    lobbyId = a.id;
    lobbyCode = a.invite_code;
  });

  it("only allows today's puzzle", async () => {
    await expect(createLobby(ANN, crewId, OLD)).rejects.toThrow(/today's puzzle/);
    await expect(createLobby(ANN, crewId, String(Number(T) + 5))).rejects.toThrow(/today's puzzle/);
  });

  it("rejects unsupported games and past deadlines", async () => {
    await expect(
      as(ANN, `select create_lobby($1, 'spelling-bee', '1', now() + interval '1 day')`, [crewId]),
    ).rejects.toThrow(/Unsupported game/);
    await expect(
      as(ANN, `select create_lobby($1, 'wordle', $2, now() - interval '1 hour')`, [crewId, T]),
    ).rejects.toThrow(/future/);
  });

  it("hides crews and lobbies from non-members", async () => {
    expect(await as(EVE, "select * from crews")).toHaveLength(0);
    expect(await as(EVE, "select * from lobbies")).toHaveLength(0);
    await expect(as(EVE, `select submit_entry($1, $2, '', 'paste')`, [lobbyId, solve(T, 1)])).rejects.toThrow(
      /not found/,
    );
  });

  it("joins the crew through a lobby invite", async () => {
    await as(BOB, "select join_lobby($1)", [lobbyCode.toUpperCase()]);
    expect(await as(BOB, "select * from crews")).toHaveLength(1);
  });

  it("hides results until you submit your own", async () => {
    await as(BOB, `select submit_entry($1, $2, 'Wordle 2/6', 'paste')`, [lobbyId, solve(T, 2, grid("y.y..", "ggggg"))]);

    const before = await as<{ display_name: string; hidden: boolean; result: unknown }>(
      ANN,
      "select * from get_lobby_board($1)",
      [lobbyId],
    );
    expect(before).toMatchObject([{ display_name: "Bob Google", hidden: true, result: null }]);
    expect(await as(ANN, "select * from entries")).toHaveLength(0);

    await as(ANN, `select submit_entry($1, $2, '', 'manual')`, [lobbyId, solve(T, 2)]);
    const after = await as<{ hidden: boolean; result: { guesses: number } }>(
      ANN,
      "select * from get_lobby_board($1)",
      [lobbyId],
    );
    expect(after.map((r) => [r.hidden, r.result.guesses])).toEqual([
      [false, 2],
      [false, 2],
    ]);
    expect(await as(ANN, "select * from entries")).toHaveLength(2);
  });

  it("validates results server-side", async () => {
    await as(EVE, "select join_lobby($1)", [lobbyCode]);
    const submit = (result: string) => as(EVE, `select submit_entry($1, $2, '', 'paste')`, [lobbyId, result]);
    await expect(submit(solve(OLD, 3))).rejects.toThrow(new RegExp(`#${OLD}.*#${T}`));
    await expect(submit(solve(T, 9))).rejects.toThrow(/between 1 and 6/);
    await expect(submit(solve(T, 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
    await expect(submit(solve(T, 1, grid("hello")))).rejects.toThrow(/Invalid grid row/);

    // Junk fields are dropped; misses are stored without guesses.
    await submit(`{"puzzle":"${T}","solved":false,"guesses":4,"hard":true,"evil":1}`);
    const [row] = await as<{ result: object }>(EVE, "select result from entries where user_id = $1", [EVE]);
    expect(row.result).toEqual({ puzzle: T, solved: false, hard: true });
    await expect(submit(solve(T, 3))).rejects.toThrow(/already submitted/);
  });

  it("only lets the host void entries and close the lobby", async () => {
    await expect(as(BOB, "select close_lobby($1)", [lobbyId])).rejects.toThrow(/Only the host/);
    const [eve] = await as<{ id: string }>(ANN, "select id from entries where user_id = $1", [EVE]);
    await expect(as(BOB, "select void_entry($1)", [eve.id])).rejects.toThrow(/Only the host/);
    await as(ANN, "select void_entry($1)", [eve.id]);
    await as(ANN, "select close_lobby($1)", [lobbyId]);
    await expect(as(EVE, `select submit_entry($1, $2, '', 'manual')`, [lobbyId, solve(T, 1)])).rejects.toThrow(
      /closed/,
    );
  });

  it("closes automatically at the deadline and enforces paste-only lobbies", async () => {
    const crew = await createCrew(ANN, "Paste Only");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    const [l] = await createLobby(ANN, crew.id, T, ", true, false");
    await expect(as(BOB, `select submit_entry($1, $2, '', 'manual')`, [l.id, solve(T, 3)])).rejects.toThrow(
      /requires pasting/,
    );
    await db.query("update lobbies set closes_at = now() - interval '1 minute' where id = $1", [l.id]);
    await expect(as(BOB, `select submit_entry($1, $2, '', 'paste')`, [l.id, solve(T, 3)])).rejects.toThrow(/closed/);
  });

  it("does not let signed-out visitors call RPCs or read/write tables directly", async () => {
    await expect(as(null, "select create_crew('nope')")).rejects.toThrow(/permission denied/);
    await expect(as(null, "select * from profiles")).rejects.toThrow(/permission denied/);
    await expect(
      as(ANN, `insert into entries (lobby_id, user_id, result, source) values ($1, $2, '{}', 'manual')`, [lobbyId, ANN]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("extension", () => {
  let bobToken: string;
  let annToken: string;
  let eveToken: string;
  let weekend: { id: string; invite_code: string };

  const submit = (token: string, result: string) =>
    as<{ lobby_code: string; crew_name: string; outcome: string }>(
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
    // Ann already has Breakfast Club and Paste Only, both closed for today.
    weekend = await createCrew(ANN, "Weekend");
    await as(BOB, "select join_crew($1)", [weekend.invite_code]);
    await as(EVE, "select join_crew($1)", [weekend.invite_code]);
    const work = await createCrew(ANN, "Work");
    for (const crew of [weekend.id, work.id]) await createLobby(ANN, crew, T);
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

  it("submits to every open lobby for that puzzle in the user's crews", async () => {
    expect(outcomes(await submit(annToken, solve(T, 2, grid(".y...", "ggggg"))))).toEqual([
      ["Breakfast Club", "closed"],
      ["Paste Only", "closed"],
      ["Weekend", "submitted"],
      ["Work", "submitted"],
    ]);
    // Bob isn't in Work.
    expect(outcomes(await submit(bobToken, solve(T, 4)))).toEqual([
      ["Breakfast Club", "closed"],
      ["Paste Only", "closed"],
      ["Weekend", "submitted"],
    ]);
    const board = await as<{ source: string }>(
      BOB,
      "select * from get_lobby_board((select id from lobbies where crew_id = $1))",
      [weekend.id],
    );
    expect(board.map((r) => r.source)).toEqual(["extension", "extension"]);
  });

  it("is idempotent and ignores puzzles with no lobby", async () => {
    expect(outcomes(await submit(bobToken, solve(T, 1))).at(-1)).toEqual(["Weekend", "already"]);
    expect(await submit(bobToken, solve(OLD, 3))).toEqual([]);
  });

  it("still validates results", async () => {
    await expect(submit(eveToken, solve(T, 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
  });

  it("rejects unknown and revoked tokens", async () => {
    await expect(submit("nope", solve(T, 3))).rejects.toThrow(/not connected/);
    await as(BOB, "select revoke_extension_tokens()");
    await expect(submit(bobToken, solve(T, 3))).rejects.toThrow(/not connected/);
    expect(outcomes(await submit(annToken, solve(T, 3))).at(-1)).toEqual(["Work", "already"]);
  });
});

describe("crew owner controls", () => {
  let crew: { id: string; invite_code: string };
  let open: { id: string; invite_code: string };

  beforeAll(async () => {
    crew = await createCrew(ANN, "Owner Tests");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    await as(EVE, "select join_crew($1)", [crew.invite_code]);
    [open] = await createLobby(ANN, crew.id, T);
    await as(EVE, `select submit_entry($1, $2, '', 'manual')`, [open.id, solve(T, 3)]);
  });

  it("only the owner can remove members, and not themselves", async () => {
    await expect(as(BOB, "select remove_crew_member($1, $2)", [crew.id, EVE])).rejects.toThrow(/Only the crew owner/);
    await expect(as(ANN, "select remove_crew_member($1, $2)", [crew.id, ANN])).rejects.toThrow(/themselves/);
  });

  it("removes the member and their open entries, and keeps them out", async () => {
    await as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE]);
    const members = await as<{ user_id: string }>(ANN, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([ANN, BOB]);
    expect(await as(ANN, "select * from get_lobby_board($1)", [open.id])).toHaveLength(0);
    expect(await as(EVE, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    await expect(as(EVE, "select join_crew($1)", [crew.invite_code])).rejects.toThrow(/removed/);
    await expect(as(EVE, "select join_lobby($1)", [open.invite_code])).rejects.toThrow(/removed/);
    await expect(as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE])).rejects.toThrow(/Not a member/);
  });

  it("only the owner can delete the crew, which removes everything in it", async () => {
    await expect(as(BOB, "select delete_crew($1)", [crew.id])).rejects.toThrow(/Only the crew owner/);
    await as(ANN, "select delete_crew($1)", [crew.id]);
    expect(await as(ANN, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    expect(await as(ANN, "select * from lobbies where crew_id = $1", [crew.id])).toHaveLength(0);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from crew_bans where crew_id = $1", [crew.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe("connections and krillion", () => {
  let crew: string;
  let C: string;
  let K: string;
  const lobby = async (game: string, puzzle: string) =>
    (
      await as<{ id: string }>(ANN, `select * from create_lobby($1, $2, $3, now() + interval '1 day')`, [
        crew,
        game,
        puzzle,
      ])
    )[0].id;
  const submit = (user: string, lobbyId: string, result: object) =>
    as<{ result: Record<string, unknown> }>(user, `select * from submit_entry($1, $2, '', 'paste')`, [
      lobbyId,
      JSON.stringify(result),
    ]);

  beforeAll(async () => {
    const c = await createCrew(ANN, "More Games");
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

  it("only allows today's puzzle for each game", async () => {
    await expect(lobby("connections", String(Number(C) - 5))).rejects.toThrow(/today's puzzle/);
    await expect(lobby("krillion", String(Number(K) - 1))).rejects.toThrow(/today's puzzle/);
  });

  it("scores Connections from the grid and validates it", async () => {
    const id = await lobby("connections", C);
    await expect(
      submit(EVE, id, { puzzle: C, solved: true, mistakes: 0, grid: ["yyyy", "yyyy", "bbbb", "pppp"] }),
    ).rejects.toThrow(/does not match/);
    await expect(submit(EVE, id, { puzzle: C, grid: ["yyyy", "gbgg"] })).rejects.toThrow(/finished/);
    // Claimed perfect, but the grid has a mistake: the grid wins.
    const [bob] = await submit(BOB, id, {
      puzzle: C,
      solved: true,
      mistakes: 0,
      grid: ["yyyy", "gbgg", "gggg", "bbbb", "pppp"],
    });
    expect(bob.result).toMatchObject({ solved: true, mistakes: 1, groups: 4 });
    const [eve] = await submit(EVE, id, { puzzle: C, solved: false, groups: 2, mistakes: 0 });
    expect(eve.result).toEqual({ puzzle: C, solved: false, mistakes: 4, groups: 2 });
  });

  it("scores Krillion from the tiers and bounds manual depth", async () => {
    const id = await lobby("krillion", K);
    const [bob] = await submit(BOB, id, { puzzle: K, points: 700, tiers: "sprxksd" });
    expect(bob.result).toEqual({ puzzle: K, points: 315, tiers: "sprxksd" });
    await expect(submit(EVE, id, { puzzle: K, points: 701 })).rejects.toThrow(/between/);
    await expect(submit(EVE, id, { puzzle: K, tiers: "kkkkkkkk" })).rejects.toThrow(/Invalid answers/);
    const [eve] = await submit(EVE, id, { puzzle: K, points: 360 });
    expect(eve.result).toEqual({ puzzle: K, points: 360 });
  });
});

describe("recreating a closed lobby", () => {
  it("reopens it if nobody played, and leaves a finished one alone", async () => {
    const crew = await createCrew(ANN, "Reopen");
    await as(BOB, "select join_crew($1)", [crew.invite_code]);
    const [first] = await createLobby(ANN, crew.id, T);
    await as(ANN, "select close_lobby($1)", [first.id]);

    // Bob creates it again: same lobby, open, and he's now the host.
    const [again] = await as<{ id: string; closed_at: string | null; created_by: string; allow_manual: boolean }>(
      BOB,
      `select * from create_lobby($1, 'wordle', $2, now() + interval '1 day', true, false)`,
      [crew.id, T],
    );
    expect(again).toMatchObject({ id: first.id, closed_at: null, created_by: BOB, allow_manual: false });

    await as(BOB, `select submit_entry($1, $2, '', 'paste')`, [first.id, solve(T, 3)]);
    await as(BOB, "select close_lobby($1)", [first.id]);
    const [finished] = await createLobby(ANN, crew.id, T);
    expect(finished).toMatchObject({ id: first.id });
    expect((finished as { closed_at?: string | null }).closed_at).not.toBeNull();
  });
});
