import { expect, test } from "@playwright/test";
import { createCrewApi, loginBrowser, newGuest, type Signed } from "./support/accounts";

// A guest's crew lasts the day. At midnight (crew time) the server deletes it,
// along with the guest account; until then the crew page warns about it.
//
// How midnight is faked: the server checks real time (and its deleting is
// covered in supabase/schema.test.ts), but what the page shows depends on the
// browser's clock, which Playwright sets. The crew's real deadline is hours
// away, so the server leaves it alone while the browser goes past it.

let guest: Signed;
let crewId: string | null = null;

test.afterEach(async () => {
  if (crewId) await guest.client.rpc("delete_crew", { p_crew: crewId });
  crewId = null;
});

const notice = (page: import("@playwright/test").Page) => page.locator(".guest-expiry");

test("at midnight, a guest is told their crew is being deleted and to sign in with Google", async ({
  page,
  context,
}) => {
  guest = await newGuest(`Night Guest ${Date.now() % 10000}`);
  const crew = (await createCrewApi(guest, "Guest Night", ["wordle"])) as Awaited<ReturnType<typeof createCrewApi>> & {
    guest_expires_at: string;
  };
  crewId = crew.id;
  expect(crew.guest_expires_at).toBeTruthy();
  const midnight = new Date(crew.guest_expires_at).getTime();

  // 11:55pm on the crew's day.
  await page.clock.install({ time: new Date(midnight - 5 * 60_000) });
  await loginBrowser(context, guest);
  await page.goto(`/crew/${crew.invite_code}`);

  // Before midnight: a warning, with the time left and how to keep the crew.
  await expect(notice(page)).toContainText("This crew will be deleted at midnight (in 5m)");
  await expect(notice(page)).toContainText("along with your guest account and its scores");
  await expect(notice(page).getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/profile");

  // Midnight. The page's clock ticks every 15s.
  await page.clock.fastForward("06:00");

  // After: it says the crew is being deleted, and to sign in now to save it.
  await expect(notice(page)).toContainText("Today's over, so this crew is being deleted");
  await expect(notice(page)).toContainText("Sign in with Google now to keep the crew and save your stats");
  await expect(notice(page)).not.toContainText("in 5m");
});

test("guests can make one crew, and are told it's deleted at midnight", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill(`One Crew ${Date.now() % 10000}`);
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();

  const add = page.getByRole("button", { name: "Add a new crew" });
  await expect(page.getByText("As a guest you can make one crew.")).toBeVisible();
  await add.click();
  await page.getByRole("dialog").getByLabel("Crew name").fill("Guest Crew");
  await page.getByRole("button", { name: "Create crew" }).click();

  // The crew page warns straight away.
  await expect(page).toHaveURL(/\/crew\/[a-z0-9]+$/);
  await expect(notice(page)).toContainText("This crew will be deleted at midnight");

  // Back home: no second crew.
  await page.goto("/");
  await expect(add).toBeDisabled();
  await expect(page.getByText("Guests can make one crew.")).toBeVisible();
});
