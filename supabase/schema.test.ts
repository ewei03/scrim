// Runs the real migrations in an in-memory Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema, then exercises the RPCs and RLS rules
// as different users.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { manualConnections } from "@/games/connections";
import { manualKrillion } from "@/games/krillion";
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

const submitEntry = (user: string, crew: string, result: string, source = "paste", game = "wordle") =>
  as(user, "select submit_entry($1, $2, $3, 'Shared result', $4)", [crew, game, result, source]);

const board = (user: string, crew: string, puzzle: string, game = "wordle") =>
  as<{ entry_id: string; user_id: string; display_name: string; hidden: boolean; source: string; result: unknown }>(
    user,
    "select * from get_round_board($1, $2, $3)",
    [crew, game, puzzle],
  );

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
    const [la] = await as<{ timezone: string }>(ANN, "select * from create_crew('West', 'America/Los_Angeles')");
    expect(la.timezone).toBe("America/Los_Angeles");
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
    await expect(submit(`{"puzzle":"x1","solved":true,"guesses":3}`)).rejects.toThrow(/Invalid puzzle/);
    await expect(submit(solve(T, 9))).rejects.toThrow(/between 1 and 6/);
    await expect(submit(solve(T, 2, grid("ggggg", "ggggg")))).rejects.toThrow(/does not match/);
    await expect(submit(solve(T, 1, grid("hello")))).rejects.toThrow(/Invalid grid row/);
    await expect(
      as(EVE, "select submit_entry($1, 'wordle', $2, '', 'extension')", [crew.id, solve(T, 1)]),
    ).rejects.toThrow(/Invalid source/);

    // Junk fields are dropped; misses are stored without guesses.
    await submit(`{"puzzle":"${T}","solved":false,"guesses":4,"hard":true,"evil":1}`);
    const [row] = await as<{ result: object }>(EVE, "select result from entries where user_id = $1", [EVE]);
    expect(row.result).toEqual({ puzzle: T, solved: false, hard: true });
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
    await expect(as(ANN, "select update_crew_settings($1, p_name => '   ')", [crew.id])).rejects.toThrow(/1 to 40/);
    await expect(as(ANN, "select update_crew_settings($1, p_name => $2)", [crew.id, "x".repeat(41)])).rejects.toThrow(
      /1 to 40/,
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
    await createCrew(ANN, "Krillion Only", "krillion");
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

  it("rejects unknown and revoked tokens", async () => {
    await expect(submit("nope", solve(T, 3))).rejects.toThrow(/not connected/);
    await as(BOB, "select revoke_extension_tokens()");
    await expect(submit(bobToken, solve(T, 3))).rejects.toThrow(/not connected/);
    expect(outcomes(await submit(annToken, solve(T, 3))).at(-1)).toEqual(["Work", "already"]);
  });
});

describe("crew owner controls", () => {
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

  it("removes the member and their open entries, and keeps them out", async () => {
    await as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE]);
    const members = await as<{ user_id: string }>(ANN, "select user_id from crew_members where crew_id = $1", [crew.id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([ANN, BOB]);
    expect((await board(ANN, crew.id, T)).map((r) => r.user_id)).toEqual([BOB]);
    expect(await as(EVE, "select * from crews where id = $1", [crew.id])).toHaveLength(0);
    await expect(as(EVE, "select join_crew($1)", [crew.invite_code])).rejects.toThrow(/removed/);
    await expect(as(ANN, "select remove_crew_member($1, $2)", [crew.id, EVE])).rejects.toThrow(/Not a member/);
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
      submit(EVE, "connections", { puzzle: String(Number(C) - 5), solved: true, mistakes: 0 }),
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
    await submit(EVE, "connections", { puzzle: C, solved: false, groups: 2, mistakes: 0 });
    expect(await stored(EVE, "connections")).toEqual({ puzzle: C, solved: false, mistakes: 4, groups: 2 });
  });

  it("scores Krillion from the tiers, bounds depth, and closes at New York midnight", async () => {
    await expect(submit(ANN, "krillion", { puzzle: K, points: 100 })).rejects.toThrow(/doesn't play krillion/);
    await as(ANN, "select set_crew_game($1, 'krillion', true)", [crew]);
    await expect(submit(EVE, "krillion", { puzzle: String(Number(K) - 1), points: 100 })).rejects.toThrow(
      /day is over/,
    );
    await submit(ANN, "krillion", { puzzle: K, points: 700, tiers: "sprxksd" });
    expect(await stored(ANN, "krillion")).toEqual({ puzzle: K, points: 315, tiers: "sprxksd" });
    await expect(submit(EVE, "krillion", { puzzle: K, points: 701 })).rejects.toThrow(/between/);
    await expect(submit(EVE, "krillion", { puzzle: K, tiers: "kkkkkkkk" })).rejects.toThrow(/Invalid answers/);

    const { rows } = await db.query<{ ok: boolean }>(
      `select closes_at = ((date '2026-07-15' + $1::int + 1)::timestamp at time zone 'America/New_York') as ok
       from rounds where crew_id = $2 and game = 'krillion'`,
      [K, crew],
    );
    expect(rows).toEqual([{ ok: true }]);
  });
});

describe("extension rankings", () => {
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
    for (const r of rounds) {
      await db.query("insert into rounds (id, crew_id, game, puzzle_id, closes_at) values ($1, $2, 'wordle', $3, $4)", [
        r.id,
        crew.id,
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
});

describe("game suggestions", () => {
  it("accepts suggestions from signed-in users and keeps them private", async () => {
    await as(BOB, "select suggest_game($1, $2, $3)", ["  Strands ", "https://nytimes.com/games/strands", "pls"]);
    await expect(as(null, "select suggest_game('Nope')")).rejects.toThrow(/permission denied/);
    await expect(as(BOB, "select suggest_game('  ')")).rejects.toThrow(/name/);
    await expect(as(BOB, "select suggest_game('X', 'javascript:alert(1)')")).rejects.toThrow(/web address/);

    // Nobody can read them through the API, not even the author.
    await expect(as(BOB, "select * from game_suggestions")).rejects.toThrow(/permission denied/);
    await expect(as(ANN, "select * from game_suggestions")).rejects.toThrow(/permission denied/);

    const { rows } = await db.query<{ name: string; user_id: string; notes: string; email: string | null }>(
      "select name, user_id, notes, email from game_suggestions",
    );
    expect(rows).toEqual([{ name: "Strands", user_id: BOB, notes: "pls", email: null }]);
  });

  it("takes an optional contact email and checks it looks like one", async () => {
    await expect(as(ANN, "select suggest_game('X', null, null, 'not an email')")).rejects.toThrow(/email/);
    await expect(as(ANN, "select suggest_game('X', null, null, 'a@b')")).rejects.toThrow(/email/);
    await as(ANN, "select suggest_game('Spelling Bee', null, null, '  Ann@Example.COM ')");
    const { rows } = await db.query<{ email: string }>("select email from game_suggestions where user_id = $1", [ANN]);
    expect(rows).toEqual([{ email: "ann@example.com" }]);
    await db.query("delete from game_suggestions where user_id = $1", [ANN]);
  });

  it("makes each user wait an hour between suggestions", async () => {
    await as(ANN, "select suggest_game('First')");
    await expect(as(ANN, "select suggest_game('Second')")).rejects.toThrow(/an hour/);

    await db.query("update game_suggestions set created_at = now() - interval '61 minutes' where user_id = $1", [ANN]);
    await as(ANN, "select suggest_game('Second')");
  });

  it("limits each user to five a day", async () => {
    for (let i = 0; i < 5; i++) {
      await as(EVE, "select suggest_game($1)", [`Game ${i}`]);
      // Step past the hourly cooldown, keeping every row inside the last day.
      await db.query(
        "update game_suggestions set created_at = created_at - interval '61 minutes' where user_id = $1",
        [EVE],
      );
    }
    await expect(as(EVE, "select suggest_game('One more')")).rejects.toThrow(/tomorrow/);
  });
});
