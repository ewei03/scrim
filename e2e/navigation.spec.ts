import { expect, test, type Locator, type Page } from "@playwright/test";
import { accounts, hasAccounts, loginBrowser, newGuest, NO_ACCOUNTS, signIn } from "./support/accounts";

// 3. The header and footer buttons and links.

/** Clicks the dimmed area outside a modal (top-left corner of the window). */
async function clickBackdrop(page: Page) {
  await page.mouse.click(8, 8);
}

/** Opens a modal, then checks both ways of closing it: the × button and clicking outside. */
async function checkModalCloses(page: Page, open: () => Promise<void>, dialog: Locator) {
  await open();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await open();
  await expect(dialog).toBeVisible();
  await clickBackdrop(page);
  await expect(dialog).toBeHidden();

  // Escape closes it too.
  await open();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
});

test("Help opens the guide and closes with × or a click outside", async ({ page }) => {
  const help = page.getByRole("dialog", { name: "How Scrim works" });
  await checkModalCloses(page, () => page.getByRole("button", { name: "How Scrim works" }).click(), help);

  // Clicking inside the guide doesn't close it.
  await page.getByRole("button", { name: "How Scrim works" }).click();
  await help.getByRole("heading", { name: "How it works" }).click();
  await expect(help).toBeVisible();
});

test("Help's tips link to Suggest a game and to signing in", async ({ page }) => {
  const help = page.getByRole("dialog", { name: "How Scrim works" });
  await page.getByRole("button", { name: "How Scrim works" }).click();
  await help.getByRole("button", { name: "here!" }).click();
  await expect(help).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Feedback" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "How Scrim works" }).click();
  await help.getByRole("link", { name: "Sign in" }).click();
  await expect(help).toBeHidden();
  await expect(page).toHaveURL(/\/profile$/);
});

test("the theme toggle switches dark and light mode, and remembers it", async ({ page }) => {
  const html = page.locator("html");
  const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const dark = await bodyBackground();

  // Remembered after a reload.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await bodyBackground()).not.toBe(dark);
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
});

test("Feedback opens from the footer and closes with × or a click outside", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await checkModalCloses(page, () => page.getByRole("button", { name: "Feedback" }).click(), dialog);

  // Signed out, it asks you to sign in first.
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(dialog.getByText("Sign in to send feedback.")).toBeVisible();
});

test("guests can report a problem, but are asked to link Google before suggesting a game", async ({ page, context }) => {
  await loginBrowser(context, await newGuest("Feedback Guest"));
  let sent: Record<string, unknown> | null = null;
  await context.route("**/rest/v1/rpc/send_feedback", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });

  await dialog.getByLabel("Suggest a game").check();
  await expect(dialog.getByText("Suggesting a game needs a Google account.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Link one on your profile" })).toHaveAttribute("href", "/profile");
  await expect(dialog.getByRole("button", { name: "Send suggestion" })).toHaveCount(0);

  await dialog.getByLabel("Something's not working").check();
  const send = dialog.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeDisabled(); // a message is required
  await dialog.getByLabel("What happened?").fill("Added by the e2e tests");
  await send.click();
  await expect(dialog.getByText("Thanks! Your message was sent.")).toBeVisible();
  expect(sent).toMatchObject({ p_kind: "problem", p_message: "Added by the e2e tests", p_name: null });
  expect((sent as { p_details: { browser: string } } | null)?.p_details.browser).toBeTruthy();
});

test("Suggest a game sends a suggestion from a Google (regular) account", async ({ page, context }) => {
  test.skip(!hasAccounts, NO_ACCOUNTS);
  await loginBrowser(context, await signIn("owner"));
  // Answer the request here rather than storing a real suggestion (and starting the cooldown).
  let sent: Record<string, unknown> | null = null;
  await context.route("**/rest/v1/rpc/send_feedback", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/games");
  // "here!" opens the form on Suggest a game.
  await page.getByRole("button", { name: "here!" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await expect(dialog.getByLabel("Suggest a game")).toBeChecked();

  const send = dialog.getByRole("button", { name: "Send suggestion" });
  await expect(send).toBeDisabled(); // a game name is required
  await dialog.getByLabel("Game", { exact: true }).fill("Strands");
  await dialog.getByLabel("Link (optional)").fill("https://www.nytimes.com/games/strands");
  await dialog.getByLabel("Anything else? (optional)").fill("Added by the e2e tests");
  await send.click();

  await expect(dialog.getByText("Thanks! Your message was sent.")).toBeVisible();
  // The account's own email is filled in for them.
  expect(sent).toMatchObject({
    p_kind: "game",
    p_name: "Strands",
    p_url: "https://www.nytimes.com/games/strands",
    p_email: accounts.owner.email,
  });
});

test("GitHub opens the repository in a new tab", async ({ page }) => {
  const link = page.getByRole("link", { name: "GitHub" });
  await expect(link).toHaveAttribute("target", "_blank");
  const opened = page.waitForEvent("popup");
  await link.click();
  const tab = await opened;
  await expect.poll(() => tab.url()).toMatch(/^https:\/\/github\.com\/ewei03\/scrim/);
  await tab.close();
});

test("the @eggnonk credit links to X in a new tab", async ({ page }) => {
  const link = page.getByRole("link", { name: "@eggnonk" });
  await expect(link).toHaveAttribute("href", "https://x.com/eggnonk");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("Privacy & Terms opens, and its button goes back home", async ({ page }) => {
  await page.getByRole("link", { name: "Privacy & Terms" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy & Terms" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();

  await page.getByRole("link", { name: "← Back to Scrim" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Start scrimming" })).toBeVisible();
});

test("Games lists every game, crediting and linking each one", async ({ page }) => {
  await page.getByRole("link", { name: "Games", exact: true }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible();
  const items = page.locator("article ul li");
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: "Wordle" })).toHaveText("Wordle by The New York Times");
  await expect(items.filter({ hasText: "Krillion" })).toHaveText("Krillion by krillion.io");
  await expect(page.getByRole("link", { name: "Wordle", exact: true })).toHaveAttribute(
    "href",
    "https://www.nytimes.com/games/wordle/index.html",
  );

  await page.getByRole("link", { name: "← Back to Scrim" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the SCRIM logo goes home, and old addresses redirect", async ({ page }) => {
  await page.goto("/privacy");
  await page.getByRole("link", { name: /SCRIM/ }).first().click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/me");
  await expect(page).toHaveURL(/\/profile$/);
});
