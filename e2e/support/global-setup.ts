import { deleteOwnedCrews, hasAccounts, hasSupabase, leaveAllCrews, signIn } from "./accounts";

/** Before the run: clear crews left behind by an earlier run that stopped part-way. */
export default async function globalSetup() {
  if (!hasSupabase) {
    throw new Error("Supabase isn't configured: .env.local needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  if (!hasAccounts) {
    console.warn("\n[e2e] No test accounts in .env.test.local: tests that need a regular account will be skipped.\n");
    return;
  }
  const owner = await signIn("owner");
  const friend = await signIn("friend");
  await deleteOwnedCrews(owner);
  await deleteOwnedCrews(friend);
  await leaveAllCrews(friend);
}
