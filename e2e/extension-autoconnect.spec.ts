import { loginBrowser, newGuest } from "./support/accounts";
import { expect, test } from "./support/fixtures";

// With the extension installed, signing in connects it by itself: there's no
// Connect or Disconnect to press. Signing out disconnects it.

test("signing in connects the extension by itself, and signing out disconnects it", async ({ extContext }) => {
  const page = extContext.pages()[0] ?? (await extContext.newPage());
  await loginBrowser(extContext, await newGuest(`Auto Ext ${Date.now() % 10000}`));
  const [worker] = extContext.serviceWorkers();
  const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
  const notConnected = (popup: import("@playwright/test").Page) => popup.getByText("Not connected.", { exact: false });

  // Straight to the profile page: connected, without clicking anything, and no Disconnect.
  await page.goto("/profile");
  await expect(page.getByText("Extension connected successfully.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect extension" })).toHaveCount(0);

  // The extension's popup agrees.
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await expect(notConnected(popup)).toHaveCount(0);

  // Signing out disconnects it.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("dialog", { name: "Are you sure?" })).toBeVisible(); // guests are warned first
  await page.getByRole("dialog", { name: "Are you sure?" }).getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
  await popup.reload();
  await expect(notConnected(popup)).toBeVisible();
});
