import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { FakeGames } from "./games";

const SOURCE = path.resolve(__dirname, "../../extension");

/**
 * The extension to load. It only sends results to Supabase projects its
 * manifest allows, so when the tests use a separate project (E2E_SUPABASE_URL,
 * see playwright.config.ts) they load a copy that allows that one too. The
 * real extension/ folder is never changed.
 */
const EXTENSION = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const manifest = JSON.parse(readFileSync(path.join(SOURCE, "manifest.json"), "utf8"));
  const permission = url ? `${new URL(url).origin}/*` : null;
  if (!permission || manifest.host_permissions.includes(permission)) return SOURCE;
  const copy = mkdtempSync(path.join(tmpdir(), "scrim-e2e-extension-"));
  cpSync(SOURCE, copy, { recursive: true });
  manifest.host_permissions.push(permission);
  writeFileSync(path.join(copy, "manifest.json"), JSON.stringify(manifest, null, 2));
  return copy;
})();

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

/**
 * Makes sure the extension is connected to the signed-in account. Signing in
 * connects it by itself; one connected to another account (an earlier test's)
 * is switched over with the button, like a player would.
 */
export async function connectExtension(page: Page) {
  await page.goto("/profile");
  const connected = page.getByText("Extension connected successfully.");
  const switchAccount = page.getByRole("button", { name: "Connect to this account" });
  await expect(connected.or(switchAccount)).toBeVisible();
  if (await switchAccount.isVisible()) await switchAccount.click();
  await expect(connected).toBeVisible();
}
