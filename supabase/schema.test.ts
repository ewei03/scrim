// Runs the real migration in an in-memory Postgres (PGlite) with a minimal
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

/** Run a query as a signed-in user, with RLS applied. */
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values
     ($1, '{"display_name":"Ann"}'), ($2, '{"full_name":"Bob Google"}'), ($3, '{}')`,
    [ANN, BOB, EVE],
  );
});

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
    const [crew] = await as<{ id: string }>(ANN, "select * from create_crew('Breakfast Club')");
    crewId = crew.id;
    const create = `select * from create_lobby($1, 'wordle', '1612', now() + interval '1 day')`;
    const [a] = await as<{ id: string; invite_code: string }>(ANN, create, [crewId]);
    const [b] = await as<{ id: string }>(ANN, create, [crewId]);
    expect(b.id).toBe(a.id);
    lobbyId = a.id;
    lobbyCode = a.invite_code;
  });

  it("rejects unsupported games and past deadlines", async () => {
    await expect(
      as(ANN, `select create_lobby($1, 'spelling-bee', '1', now() + interval '1 day')`, [crewId]),
    ).rejects.toThrow(/Unsupported game/);
    await expect(as(ANN, `select create_lobby($1, 'wordle', '1613', now() - interval '1 hour')`, [crewId])).rejects.toThrow(
      /future/,
    );
  });

  it("hides crews and lobbies from non-members", async () => {
    expect(await as(EVE, "select * from crews")).toHaveLength(0);
    expect(await as(EVE, "select * from lobbies")).toHaveLength(0);
    await expect(as(EVE, `select submit_entry($1, $2, '', 'paste')`, [lobbyId, solve("1612", 1)])).rejects.toThrow(
      /not found/,
    );
  });

  it("joins the crew through a lobby invite", async () => {
    await as(BOB, "select join_lobby($1)", [lobbyCode.toUpperCase()]);
    expect(await as(BOB, "select * from crews")).toHaveLength(1);
  });

  it("hides results until you submit your own", async () => {
    await as(BOB, `select submit_entry($1, $2, 'Wordle 1,612 2/6', 'paste')`, [
      lobbyId,
      solve("1612", 2, grid("y.y..", "ggggg")),
    ]);

    const before = await as<{ display_name: string; hidden: boolean; result: unknown }>(
      ANN,
      "select * from get_lobby_board($1)",
      [lobbyId],
    );
    expect(before).toMatchObject([{ display_name: "Bob Google", hidden: true, result: null }]);
    expect(await as(ANN, "select * from entries")).toHaveLength(0);

    await as(ANN, `select submit_entry($1, $2, '', 'manual')`, [lobbyId, solve("1612", 2)]);
    const after = await as<{ hidden: boolean; result: { guesses: number } }>(ANN, "select * from get_lobby_board($1)", [
      lobbyId,
    ]);
    expect(after.map((r) => [r.hidden, r.result.guesses])).toEqual([
      [false, 2],
      [false, 2],
    ]);
    expect(await as(ANN, "select * from entries")).toHaveLength(2);
  });

  it("validates results server-side", async () => {
    await as(EVE, "select join_crew($1)", [
      (await as<{ invite_code: string }>(ANN, "select invite_code from crews"))[0].invite_code,
    ]);
    const submit = (result: string) => as(EVE, `select submit_entry($1, $2, '', 'paste')`, [lobbyId, result]);
    await expect(submit(solve("1611", 3))).rejects.toThrow(/#1611.*#1612/);
    await expect(submit(solve("1612", 9))).rejects.toThrow(/between 1 and 6/);
    await expect(submit(solve("1612", 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
    await expect(submit(solve("1612", 1, grid("hello")))).rejects.toThrow(/Invalid grid row/);

    // Junk fields are dropped; misses are stored without guesses.
    await submit(`{"puzzle":"1612","solved":false,"guesses":4,"hard":true,"evil":1}`);
    const [row] = await as<{ result: object }>(EVE, "select result from entries where user_id = $1", [EVE]);
    expect(row.result).toEqual({ puzzle: "1612", solved: false, hard: true });
    await expect(submit(solve("1612", 3))).rejects.toThrow(/already submitted/);
  });

  it("only lets the host void entries and close the lobby", async () => {
    await expect(as(BOB, "select close_lobby($1)", [lobbyId])).rejects.toThrow(/Only the host/);
    const [eve] = await as<{ id: string }>(ANN, "select id from entries where user_id = $1", [EVE]);
    await expect(as(BOB, "select void_entry($1)", [eve.id])).rejects.toThrow(/Only the host/);
    await as(ANN, "select void_entry($1)", [eve.id]);
    await as(ANN, "select close_lobby($1)", [lobbyId]);
    await expect(as(EVE, `select submit_entry($1, $2, '', 'manual')`, [lobbyId, solve("1612", 1)])).rejects.toThrow(
      /closed/,
    );
  });

  it("closes automatically at the deadline and enforces paste-only lobbies", async () => {
    const [l] = await as<{ id: string }>(
      ANN,
      `select * from create_lobby($1, 'wordle', '1700', now() + interval '1 day', true, false)`,
      [crewId],
    );
    await expect(as(BOB, `select submit_entry($1, $2, '', 'manual')`, [l.id, solve("1700", 3)])).rejects.toThrow(
      /requires pasting/,
    );
    await db.query("update lobbies set closes_at = now() - interval '1 minute' where id = $1", [l.id]);
    await expect(as(BOB, `select submit_entry($1, $2, '', 'paste')`, [l.id, solve("1700", 3)])).rejects.toThrow(/closed/);
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
  const submit = (token: string, result: string) =>
    as<{ lobby_code: string; crew_name: string; outcome: string }>(
      null,
      `select * from extension_submit($1, 'wordle', $2, 'auto')`,
      [token, result],
    );

  beforeAll(async () => {
    [{ create_extension_token: bobToken }] = await as<{ create_extension_token: string }>(
      BOB,
      "select create_extension_token()",
    );
    [{ create_extension_token: annToken }] = await as<{ create_extension_token: string }>(
      ANN,
      "select create_extension_token()",
    );
    const [work] = await as<{ id: string }>(ANN, "select * from create_crew('Work')");
    for (const crew of [crewId, work.id]) {
      await as(ANN, `select create_lobby($1, 'wordle', '1800', now() + interval '1 day')`, [crew]);
    }
  });

  it("only signed-in users can mint tokens, and tokens are stored hashed", async () => {
    expect(bobToken).toMatch(/^[0-9a-f]{64}$/);
    await expect(as(null, "select create_extension_token()")).rejects.toThrow(/permission denied/);
    await expect(as(BOB, "select * from extension_tokens")).rejects.toThrow(/permission denied/);
    const [{ n }] = await db.query<{ n: number }>(
      "select count(*)::int as n from extension_tokens where token_hash = convert_to($1, 'UTF8')",
      [bobToken],
    ).then((r) => r.rows);
    expect(n).toBe(0);
  });

  it("submits to every open lobby for that puzzle in the user's crews", async () => {
    const result = solve("1800", 2, grid(".y...", "ggggg"));
    expect((await submit(annToken, result)).map((r) => [r.crew_name, r.outcome])).toEqual([
      ["Breakfast Club", "submitted"],
      ["Work", "submitted"],
    ]);
    // Bob isn't in Work.
    expect((await submit(bobToken, solve("1800", 4))).map((r) => [r.crew_name, r.outcome])).toEqual([
      ["Breakfast Club", "submitted"],
    ]);
    const board = await as<{ source: string; display_name: string }>(BOB, "select * from get_lobby_board((select id from lobbies where puzzle_id = '1800' and crew_id = $1))", [crewId]);
    expect(board.map((r) => r.source)).toEqual(["extension", "extension"]);
  });

  it("is idempotent and skips closed lobbies", async () => {
    expect((await submit(bobToken, solve("1800", 1))).map((r) => r.outcome)).toEqual(["already"]);
    await as(BOB, "select join_crew((select invite_code from crews where id = $1))", [crewId]);
    await db.query("update lobbies set closed_at = now() where puzzle_id = '1612'");
    expect((await submit(bobToken, solve("1612", 3))).map((r) => r.outcome)).toEqual(["closed"]);
    expect(await submit(bobToken, solve("9999", 3))).toEqual([]);
  });

  it("still validates results", async () => {
    await as(ANN, `select create_lobby($1, 'wordle', '1801', now() + interval '1 day')`, [crewId]);
    await expect(submit(bobToken, solve("1801", 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
  });

  it("rejects unknown and revoked tokens", async () => {
    await expect(submit("nope", solve("1801", 3))).rejects.toThrow(/not connected/);
    await as(BOB, "select revoke_extension_tokens()");
    await expect(submit(bobToken, solve("1801", 3))).rejects.toThrow(/not connected/);
    expect((await submit(annToken, solve("1801", 3))).map((r) => r.outcome)).toEqual(["submitted"]);
  });
});
