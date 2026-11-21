import { expect, test } from "@playwright/test";
import { answerConfirm } from "./support/accounts";

// 1. Play as guest.
test.describe("Play as guest", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
  });

  test("a blank name can't start a guest game", async ({ page }) => {
    const name = page.getByPlaceholder("Your name");
    const play = page.getByRole("button", { name: "Sign in as guest" });

    await expect(name).toHaveValue("");
    await expect(play).toBeDisabled();
    // The name box is required, so the browser won't send it empty either.
    expect(await name.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);

    // Only spaces counts as blank too.
    await name.fill("   ");
    await expect(play).toBeDisabled();

    // Pressing Enter doesn't get around it: still signed out.
    await name.press("Enter");
    await page.waitForTimeout(1_500);
    await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
    await expect(page.locator(".whoami")).toHaveCount(0);
  });

  test("a name starts a guest game", async ({ page }) => {
    const name = `Guest ${Date.now() % 100000}`;
    await page.getByPlaceholder("Your name").fill(name);
    await page.getByRole("button", { name: "Sign in as guest" }).click();

    // Signed in: the header shows the name with a guest tag, and the dashboard loads.
    const whoami = page.locator(".whoami");
    await expect(whoami).toContainText(name);
    await expect(whoami.locator(".tag")).toHaveText("guest");
    await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();

    // Guests join crews rather than make them (see guest-crew.spec.ts).
    await expect(page.getByRole("button", { name: "Add a new crew" })).toBeDisabled();
    await expect(page.getByText("Guests can join crews with an invite link.")).toBeVisible();

    // Still signed in after a reload.
    await page.reload();
    await expect(page.locator(".whoami")).toContainText(name);
  });

  test("a guest can sign out from their profile", async ({ page }) => {
    await page.getByPlaceholder("Your name").fill("Leaving Guest");
    await page.getByRole("button", { name: "Sign in as guest" }).click();
    await page.locator(".whoami").click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await answerConfirm(page, true, "Guest accounts can't be recovered after signing out. Sign out anyway?");
    await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
  });
});
