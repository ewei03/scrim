// Runs the real migration in an in-memory Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then exercises the RPCs and RLS rules
// as different users.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8");

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

const SUPABASE_DEFAULT_GRANTS = `
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`;

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
  await db.exec(MIGRATION);
  await db.exec(SUPABASE_DEFAULT_GRANTS);
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

  it("does not let signed-out visitors call RPCs or write tables directly", async () => {
    await expect(as(null, "select create_crew('nope')")).rejects.toThrow(/permission denied/);
    await expect(
      as(ANN, `insert into entries (lobby_id, user_id, result, source) values ($1, $2, '{}', 'manual')`, [lobbyId, ANN]),
    ).rejects.toThrow(/row-level security/);
  });
});
