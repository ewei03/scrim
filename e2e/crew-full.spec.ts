import { expect, test } from "@playwright/test";
import {
  createCrewApi,
  deleteOwnedCrews,
  hasAccounts,
  loginBrowser,
  newGuest,
  NO_ACCOUNTS,
  signIn,
  type Signed,
} from "./support/accounts";

// A crew holds at most 10 players, owner included. The 11th person to open the
// invite link is told it's full, and isn't added.
//
// The owner is the regular test account (guests can't make crews); the other
// players are guests, made on the fly.

test.skip(!hasAccounts, NO_ACCOUNTS);

let owner: Signed | null = null;

test.afterEach(async () => {
  if (owner) await deleteOwnedCrews(owner);
  owner = null;
});

test("the 11th player gets a 'crew is full' error from the invite link", async ({ page, context }) => {
  const tag = Date.now() % 10000;
  owner = await signIn("owner");
  await deleteOwnedCrews(owner);
  const crew = await createCrewApi(owner, "Full House");

  // Nine more: ten players.
  for (let i = 1; i <= 9; i++) {
    const player = await newGuest(`Full P${i} ${tag}`);
    const { error } = await player.client.rpc("join_crew", { p_code: crew.invite_code });
    expect(error, `player ${i} joins`).toBeNull();
  }
  const { data: members } = await owner.client.from("crew_members").select("user_id").eq("crew_id", crew.id);
  expect(members).toHaveLength(10);

  // The 11th opens the link.
  const eleventh = await newGuest(`Full P10 ${tag}`);
  await loginBrowser(context, eleventh);
  await page.goto(`/crew/${crew.invite_code}`);
  await expect(page.locator("p.error")).toHaveText("This crew is full (10 players max)");

  // Still ten.
  const { data: after } = await owner.client.from("crew_members").select("user_id").eq("crew_id", crew.id);
  expect(after).toHaveLength(10);
});
