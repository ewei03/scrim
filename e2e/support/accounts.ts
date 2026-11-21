import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Test accounts, signed in from Node with supabase-js and handed to the
 * browser by writing the session where the site's Supabase client keeps it.
 *
 * - Guests: made on the fly (anonymous sign-in), like "Play as guest" does.
 * - Regular accounts (owner, friend): email + password users you create once
 *   in Supabase (see e2e/README.md). They stand in for Google accounts, which
 *   can't be signed into by a test: they're the same kind of non-guest account.
 */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Where supabase-js keeps the session in localStorage. */
export const STORAGE_KEY = URL_ ? `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token` : "";

export const accounts = {
  owner: { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD, name: "E2E Owner" },
  friend: { email: process.env.E2E_FRIEND_EMAIL, password: process.env.E2E_FRIEND_PASSWORD, name: "E2E Friend" },
};
export type AccountName = keyof typeof accounts;

export const hasSupabase = Boolean(URL_ && KEY);
export const hasAccounts = Object.values(accounts).every((a) => a.email && a.password);
export const NO_ACCOUNTS =
  "Needs the test accounts: set E2E_OWNER_EMAIL/PASSWORD and E2E_FRIEND_EMAIL/PASSWORD in .env.test.local (see e2e/README.md).";

export type Signed = { client: SupabaseClient; session: Session; userId: string };

function newClient() {
  return createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signs in a regular test account and makes sure its display name is the expected one. */
export async function signIn(which: AccountName): Promise<Signed> {
  const a = accounts[which];
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email: a.email!, password: a.password! });
  if (error || !data.session) throw new Error(`Couldn't sign in the ${which} test account: ${error?.message}`);
  const userId = data.session.user.id;
  await client.from("profiles").update({ display_name: a.name }).eq("id", userId);
  return { client, session: data.session, userId };
}

/** A new guest with this name. */
export async function newGuest(name: string): Promise<Signed> {
  const client = newClient();
  const { data, error } = await client.auth.signInAnonymously({ options: { data: { display_name: name } } });
  if (error || !data.session) throw new Error(`Couldn't make a guest: ${error?.message}`);
  return { client, session: data.session, userId: data.session.user.id };
}

/** Loads pages in this context as that account. Call before the first page.goto. */
export async function loginBrowser(context: BrowserContext, signed: Signed) {
  await context.addInitScript(
    ([key, value]) => {
      // Only on the Scrim site, and only once, so signing out in a test sticks.
      if (location.hostname !== "localhost" || sessionStorage.getItem("e2e-session-set")) return;
      sessionStorage.setItem("e2e-session-set", "1");
      localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(signed.session)] as const,
  );
}

/** Deletes every crew this account owns, so each test starts clean. */
export async function deleteOwnedCrews(signed: Signed) {
  const { data } = await signed.client.from("crews").select("id").eq("created_by", signed.userId);
  for (const crew of data ?? []) await signed.client.rpc("delete_crew", { p_crew: crew.id });
}

/** Leaves every crew this account is in (and doesn't own). */
export async function leaveAllCrews(signed: Signed) {
  const { data } = await signed.client.from("crew_members").select("crew_id").eq("user_id", signed.userId);
  for (const m of data ?? []) await signed.client.rpc("leave_crew", { p_crew: m.crew_id });
}

/** Makes a crew as the owner, through the API, for tests that aren't about creating one. */
export async function createCrewApi(signed: Signed, name: string, games: string[] = []) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: crew, error } = await signed.client.rpc("create_crew", { p_name: name, p_timezone: tz });
  if (error) throw new Error(`create_crew: ${error.message}`);
  for (const game of games) {
    const { error: e } = await signed.client.rpc("set_crew_game", { p_crew: crew.id, p_game: game, p_tracked: true });
    if (e) throw new Error(`set_crew_game: ${e.message}`);
  }
  return crew as { id: string; name: string; invite_code: string };
}

/**
 * Opens every game card under Today. Cards start collapsed on a first visit
 * (only games added since your last visit open by themselves).
 */
export async function expandGameCards(page: Page) {
  await page.locator(".game-card").first().waitFor();
  const collapsed = page.locator(".game-card-toggle[aria-expanded='false']");
  while ((await collapsed.count()) > 0) await collapsed.first().click();
}

/** Waits for the page to show it's signed in (the header has a profile link). */
export async function expectSignedIn(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(name) }).first().waitFor();
}
