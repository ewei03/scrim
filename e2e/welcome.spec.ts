import { expect, test } from "@playwright/test";
import { NO_ACCOUNTS, hasAccounts, signIn, loginBrowser } from "./support/accounts";

/**
 * 9. The welcome guide shows the first time a new guest lands on Scrim, and
 * never again. Google (regular) accounts don't get it.
 *
 * "New" means signed up in the last 10 minutes. The test account is older
 * than that, so the Google-account test sets the browser's clock to just
 * after it was created: to the site, it has just signed up.
 */

const welcome = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Welcome to Scrim!" });

async function signInAsGuest(page: import("@playwright/test").Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByRole("button", { name: "Sign in as guest" }).click();
}

test("a new guest sees the guide on its first visit, and not afterwards", async ({ page }) => {
  await signInAsGuest(page, "Welcome Guest");
  const guide = welcome(page);
  await expect(guide).toBeVisible();
  await expect(guide.locator(".welcome-steps > li > strong")).toHaveText([
    /Install the Scrim extension/,
    /Join a crew/,
    /Play!/,
  ]);
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toBeHidden();

  // Not on a reload…
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(welcome(page)).toBeHidden();

  // …nor coming back to the home page from elsewhere.
  await page.goto("/privacy");
  await page.getByRole("link", { name: "← Back to Scrim" }).click();
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(welcome(page)).toBeHidden();
});

test("a new guest doesn't see it again even if it was closed some other way", async ({ page }) => {
  await signInAsGuest(page, "Welcome Guest 2");
  await expect(welcome(page)).toBeVisible();

  // Leave without closing it.
  await page.goto("/profile");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(welcome(page)).toBeHidden();
});

test("a Google account never sees it, even brand-new", async ({ page, context }) => {
  test.skip(!hasAccounts, NO_ACCOUNTS);
  const owner = await signIn("owner");
  await page.clock.install({ time: new Date(Date.parse(owner.session.user.created_at) + 60_000) });
  await loginBrowser(context, owner);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(welcome(page)).toBeHidden();
});
