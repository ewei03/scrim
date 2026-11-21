import { expect, test } from "@playwright/test";
import { NO_ACCOUNTS, hasAccounts, signIn, loginBrowser } from "./support/accounts";

/**
 * 9. The welcome guide shows the first time a new account lands on Scrim, and
 * never again.
 *
 * "New" means signed up in the last 10 minutes. The test account is older
 * than that, so these tests set the browser's clock to just after it was
 * created: to the site, it has just signed up.
 */

const welcome = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Welcome to Scrim!" });

test.describe("a new account", () => {
  test.skip(!hasAccounts, NO_ACCOUNTS);

  test("sees the guide on its first visit, and not afterwards", async ({ page, context }) => {
    const owner = await signIn("owner");
    await page.clock.install({ time: new Date(Date.parse(owner.session.user.created_at) + 60_000) });
    await loginBrowser(context, owner);

    // First visit: the guide opens, with its four steps in order.
    await page.goto("/");
    const guide = welcome(page);
    await expect(guide).toBeVisible();
    await expect(guide.locator(".welcome-steps > li > strong")).toHaveText([
      /Create a crew/,
      /Pick your games/,
      /Get the Scrim extension/,
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

  test("doesn't see it again even if it was closed some other way", async ({ page, context }) => {
    const owner = await signIn("owner");
    await page.clock.install({ time: new Date(Date.parse(owner.session.user.created_at) + 60_000) });
    await loginBrowser(context, owner);
    await page.goto("/");
    await expect(welcome(page)).toBeVisible();

    // Leave without closing it.
    await page.goto("/profile");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(welcome(page)).toBeHidden();
  });
});

test("an older account never sees it, even in a new browser", async ({ page, context }) => {
  test.skip(!hasAccounts, NO_ACCOUNTS);
  await loginBrowser(context, await signIn("owner"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(welcome(page)).toBeHidden();
});

test("guests never see it", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Welcome Guest");
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(welcome(page)).toBeHidden();
});
