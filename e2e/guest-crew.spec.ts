import { expect, test } from "@playwright/test";
import {
  createCrewApi,
  deleteOwnedCrews,
  hasAccounts,
  NO_ACCOUNTS,
  signIn,
  type Signed,
} from "./support/accounts";

// Guests can't make crews: they join someone else's, by pasting the invite
// link on the home page (or opening it). They stay in it like anyone else;
// that the server doesn't remove them is covered in supabase/schema.test.ts.

test.skip(!hasAccounts, NO_ACCOUNTS);

let owner: Signed;

test.beforeEach(async () => {
  owner = await signIn("owner");
  await deleteOwnedCrews(owner);
});

test.afterEach(async () => {
  await deleteOwnedCrews(owner);
});

test("a guest can't make a crew, but joins one by pasting its invite link", async ({ page, baseURL }) => {
  const crew = await createCrewApi(owner, "Paste Crew", ["wordle"]);

  await page.goto("/");
  await page.getByPlaceholder("Your name").fill(`Paster ${Date.now() % 10000}`);
  await page.getByRole("button", { name: "Sign in as guest" }).click();
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();

  // No making crews.
  await expect(page.getByRole("button", { name: "Add a new crew" })).toBeDisabled();
  await expect(page.getByText("Guests can join crews with an invite link.")).toBeVisible();
  await expect(page.getByText("No crews yet. Join one with an invite link below.")).toBeVisible();

  // Something that isn't an invite link is turned away on the spot.
  const invite = page.getByLabel("Invite link");
  await invite.fill("https://example.com/profile");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("That doesn't look like an invite link.")).toBeVisible();

  // The real link joins.
  await invite.fill(`  ${baseURL}/crew/${crew.invite_code}  `);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/crew/${crew.invite_code}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Paste Crew" })).toBeVisible();
  await expect(page.locator(".member-chips li")).toHaveCount(2);

  // And it's listed back home.
  await page.goto("/");
  await expect(page.locator(".crew-card", { hasText: "Paste Crew" })).toBeVisible();
});
