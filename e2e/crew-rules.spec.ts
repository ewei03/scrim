import { expect, test, type Browser, type Page } from "@playwright/test";
import { createCrewApi, loginBrowser, newGuest, type Signed } from "./support/accounts";

// The owner's rules in Manage crew: approving new members. (Ranking by win
// rate is covered in supabase/schema.test.ts, next to the extension's rankings
// it has to match.) Everyone is a guest.

let owner: Signed | null = null;
let crewId: string | null = null;

test.afterEach(async () => {
  if (owner && crewId) await owner.client.rpc("delete_crew", { p_crew: crewId });
  owner = null;
  crewId = null;
});

async function pageAs(browser: Browser, who: Signed): Promise<Page> {
  const context = await browser.newContext();
  await loginBrowser(context, who);
  return context.newPage();
}

test("with approval on, the invite link asks to join and the owner lets them in or not", async ({ page, context, browser }) => {
  const tag = Date.now() % 10000;
  owner = await newGuest(`Gate ${tag}`);
  const crew = await createCrewApi(owner, "Gated", ["wordle"]);
  crewId = crew.id;
  const { error } = await owner.client.rpc("update_crew_settings", { p_crew: crew.id, p_require_approval: true });
  expect(error).toBeNull();

  // Two people open the invite link: each is told their request was sent.
  const asker = await pageAs(browser, await newGuest(`Asker ${tag}`));
  await asker.goto(`/crew/${crew.invite_code}`);
  await expect(asker.getByRole("heading", { name: "Request sent" })).toBeVisible();
  await expect(asker.getByText("You've asked to join Gated.", { exact: false })).toBeVisible();
  const turnedDown = await pageAs(browser, await newGuest(`Nope ${tag}`));
  await turnedDown.goto(`/crew/${crew.invite_code}`);
  await expect(turnedDown.getByRole("heading", { name: "Request sent" })).toBeVisible();

  // The owner is told, and answers in Manage crew.
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  await expect(page.locator(".join-requests-note")).toContainText("2 people want to join.");
  await page.getByRole("button", { name: "Review in Manage crew" }).click();
  const manage = page.getByRole("dialog", { name: "Manage crew" });
  const requests = manage.locator(".manage-members").first();
  await requests.locator("li", { hasText: `Asker ${tag}` }).getByRole("button", { name: "Approve" }).click();
  await requests.locator("li", { hasText: `Nope ${tag}` }).getByRole("button", { name: "Decline" }).click();
  await expect(manage.getByRole("heading", { name: "Requests to join" })).toHaveCount(0);
  await expect(manage.locator(".manage-members li", { hasText: `Asker ${tag}` })).toBeVisible();

  // The approved one is in; the declined one is told so.
  await asker.reload();
  await expect(asker.locator(".member-chips li")).toHaveCount(2);
  await turnedDown.reload();
  await expect(turnedDown.locator("p.error")).toHaveText("The owner of Gated didn't approve your request to join.");
});
