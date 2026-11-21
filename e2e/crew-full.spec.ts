import { expect, test } from "@playwright/test";
import { createCrewApi, loginBrowser, newGuest, type Signed } from "./support/accounts";

// A crew holds at most 10 players, owner included. The 11th person to open the
// invite link is told it's full, and isn't added.
//
// Everyone here is a guest (made on the fly), so this runs without the
// regular test accounts.

let owner: Signed | null = null;
let crewId: string | null = null;

test.afterEach(async () => {
  if (owner && crewId) await owner.client.rpc("delete_crew", { p_crew: crewId });
  owner = null;
  crewId = null;
});

test("the 11th player gets a 'crew is full' error from the invite link", async ({ page, context }) => {
  const tag = Date.now() % 10000;
  owner = await newGuest(`Full Host ${tag}`);
  const crew = await createCrewApi(owner, "Full House");
  crewId = crew.id;

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
