import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { FakeGames } from "./games";

const EXTENSION = path.resolve(__dirname, "../../extension");

/**
 * `extContext`: a fresh Chromium profile with the Scrim extension loaded
 * (extensions need their own persistent profile). Each test gets a clean one,
 * so saved results don't carry over between tests.
 *
 * `games`: the stand-in game sites, routed in that profile.
 */
export const test = base.extend<{ extContext: BrowserContext; games: FakeGames }>({
  games: async ({}, use) => {
    await use(new FakeGames());
  },
  extContext: async ({ games, headless, baseURL, viewport, launchOptions }, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), "scrim-e2e-"));
    const context = await chromium.launchPersistentContext(dir, {
      // The bundled Chromium; branded Chrome no longer loads unpacked extensions from the command line.
      channel: "chromium",
      headless,
      slowMo: launchOptions.slowMo,
      baseURL,
      viewport,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    // Wait for the extension's background worker, so its scripts are in place.
    if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker");
    await games.install(context);
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

export { expect };

/** The extension's on-page notice (it lives in a shadow root, which locators see into). */
export function toast(page: Page) {
  return page.locator("[data-scrim-toast]").last();
}

/** Connects the extension to the signed-in account from the profile page, like a player would. */
export async function connectExtension(page: Page) {
  await page.goto("/profile");
  await page.getByRole("button", { name: /Connect extension|Connect to this account/ }).click();
  await expect(page.getByText("Auto-submit is on.")).toBeVisible();
}
