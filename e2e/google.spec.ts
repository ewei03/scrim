import { expect, test, type Page } from "@playwright/test";
import { newGuest, loginBrowser } from "./support/accounts";

/**
 * 2. Google sign-in.
 *
 * These check everything up to Google's own sign-in page: the button is there,
 * and clicking it opens Google in a small pop-up window. Signing in to a real
 * Google account can't be automated (Google blocks automated browsers, and a
 * test shouldn't hold your password), so that last step is left out. The
 * signed-in experience is covered by the other tests, using email test
 * accounts in place of Google ones.
 */

const usesGoogleScript = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

/** Clicks the Google button and returns the pop-up, once it has reached Google. */
async function openGooglePopup(page: Page, label: RegExp) {
  if (usesGoogleScript) {
    // Google's button (invisible, over Scrim's) has to load before it can be clicked.
    await expect(page.locator(".google-slot iframe")).toBeAttached();
  }
  const target = usesGoogleScript ? page.locator(".google-wrap") : page.getByRole("button", { name: label });
  const popupOpened = page.waitForEvent("popup");
  await target.click();
  const popup = await popupOpened;
  // A redirect flow goes through Supabase first; either way it ends at Google.
  await expect.poll(() => popup.url(), { timeout: 20_000 }).toMatch(/^https:\/\/accounts\.google\.com\//);
  return popup;
}

test("the landing page offers Google sign-in, in a pop-up window", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Continue with Google")).toBeVisible();

  const popup = await openGooglePopup(page, /Continue with Google/);
  // A pop-up window, not a tab: it's small.
  const size = await popup.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight }));
  expect(size.w).toBeLessThan(800);
  await popup.close();

  // Closing Google's window leaves you signed out on the landing page.
  await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
});

test("a guest can link a Google account from their profile", async ({ page, context }) => {
  await loginBrowser(context, await newGuest("Linking Guest"));
  await page.goto("/profile");
  await expect(page.getByText("Link Google account")).toBeVisible();
  await expect(page.getByText("You're playing as a guest.", { exact: false })).toBeVisible();

  if (usesGoogleScript) {
    const popup = await openGooglePopup(page, /Link Google account/);
    await popup.close();
  } else {
    // Without Google's script, linking goes to Google in this same tab.
    await page.getByRole("button", { name: "Link Google account" }).click();
    await expect(page).toHaveURL(/accounts\.google\.com|supabase\.co\/auth/, { timeout: 20_000 });
  }
});
