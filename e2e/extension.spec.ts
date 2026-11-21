import type { BrowserContext, Page } from "@playwright/test";
import { NO_ACCOUNTS, accounts, createCrewApi, deleteOwnedCrews, hasAccounts, signIn, loginBrowser, type Signed } from "./support/accounts";
import { connectExtension, expect, test, toast } from "./support/fixtures";
import { WORDLE_URL, todaysWordle } from "./support/games";

/**
 * 6. Playing a game on its own website, with the Scrim extension installed.
 * 8. Playing first, then making a crew that plays that game.
 *
 * The game sites are stand-ins (see support/games.ts): they save a finished
 * game the way the real site does, and the real extension reads it.
 */

const board = (page: Page, game: string) => page.locator(".game-card", { hasText: game }).locator("table.scoreboard tbody");
const label = `Wordle #${todaysWordle().toLocaleString("en-US")}`;

/** The page the extension gave us, or a new one. */
async function firstPage(context: BrowserContext) {
  return context.pages()[0] ?? context.newPage();
}

test.describe("signed out of Scrim", () => {
  test("a finished game asks you to connect the extension", async ({ extContext, games }) => {
    const page = await firstPage(extContext);
    games.wordle = { signedIn: true, status: "WIN" };
    await page.goto(WORDLE_URL);
    await expect(page.locator("#status")).toContainText("WIN");

    await expect(toast(page)).toContainText("Not connected", { timeout: 20_000 });
    await expect(toast(page)).toContainText("Open Scrim and sign in to connect.");
    // Only one notice at a time, even as the page keeps checking.
    await page.waitForTimeout(3_000);
    await expect(page.locator("[data-scrim-toast]")).toHaveCount(1);

    // The popup says it isn't connected, and shows no results or rankings.
    const [worker] = extContext.serviceWorkers();
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await expect(popup.getByText("Not connected.", { exact: false })).toBeVisible();
    await expect(popup.locator("#panel-results")).toBeHidden();
    await expect(popup.locator("#tabs")).toBeHidden();
    await expect(popup.locator("#panel-rankings")).toBeHidden();
    await popup.close();

    // On Scrim, signed out: nothing to connect to yet. The extension is found, though.
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-scrim-extension", /\d+\.\d+/);
  });
});

test("signed out, an earlier day's game stays quiet too", async ({ extContext, games }) => {
  const page = await firstPage(extContext);
  games.wordle = { signedIn: true, status: "WIN", daysAgo: 1 };
  await page.goto(WORDLE_URL);
  await expect(page.locator("#status")).toContainText("WIN");
  await page.waitForTimeout(6_000);
  await expect(page.locator("[data-scrim-toast]")).toHaveCount(0);
});

test.describe("signed in to Scrim", () => {
  test.skip(!hasAccounts, NO_ACCOUNTS);

  let owner: Signed;
  test.beforeEach(async () => {
    owner = await signIn("owner");
    await deleteOwnedCrews(owner);
  });
  test.afterEach(async () => {
    await deleteOwnedCrews(owner);
  });

  /**
   * Opens Wordle (not played yet), then connects the extension in another tab.
   * With Wordle already open, the extension's catch-up check reads that tab
   * instead of opening its own.
   */
  async function setUp(extContext: BrowserContext) {
    await loginBrowser(extContext, owner);
    const wordle = await firstPage(extContext);
    await wordle.goto(WORDLE_URL);
    await expect(wordle.locator("#status")).toContainText("not played yet");
    const scrim = await extContext.newPage();
    await connectExtension(scrim);
    return { wordle, scrim };
  }

  test("a finished game goes straight into your crew", async ({ extContext, games }) => {
    const crew = await createCrewApi(owner, "E2E Auto Crew", ["wordle"]);
    const { wordle, scrim } = await setUp(extContext);

    await scrim.goto(`/crew/${crew.invite_code}`);
    await expect(scrim.getByText("Start playing! Your results will automatically show up here.")).toBeVisible();

    // Play (finish) Wordle.
    games.wordle = { signedIn: true, status: "WIN" };
    await wordle.bringToFront();
    await wordle.reload();
    await expect(toast(wordle)).toContainText("3/6 locked in ⚡", { timeout: 20_000 });
    await expect(toast(wordle)).toContainText(`${label} → E2E Auto Crew`);

    // It's on the crew's board, without doing anything on Scrim.
    await scrim.bringToFront();
    await expect(board(scrim, "Wordle").locator("tr", { hasText: accounts.owner.name })).toContainText("3/6", {
      timeout: 20_000,
    });
    // Your turn's done: no more "submit" panel.
    await expect(scrim.getByText("Your turn")).toHaveCount(0);

    // Opening the game again doesn't submit it twice.
    await wordle.bringToFront();
    await wordle.reload();
    await wordle.waitForTimeout(5_000);
    await expect(wordle.locator("[data-scrim-toast]")).toHaveCount(0);
  });

  test("a game played signed out of NYT doesn't count", async ({ extContext, games }) => {
    const crew = await createCrewApi(owner, "E2E NYT Crew", ["wordle"]);
    const { wordle, scrim } = await setUp(extContext);

    games.wordle = { signedIn: false, status: "WIN" };
    await wordle.bringToFront();
    await wordle.reload();
    await expect(toast(wordle)).toContainText("Not counted: signed out", { timeout: 20_000 });
    await expect(toast(wordle)).toContainText("Sign in to NYT");

    await scrim.goto(`/crew/${crew.invite_code}`);
    await expect(board(scrim, "Wordle")).toContainText("Nobody has submitted yet");
  });

  test("an earlier day's game doesn't pop up a notice", async ({ extContext, games }) => {
    await createCrewApi(owner, "E2E Yesterday", ["wordle"]);
    const { wordle } = await setUp(extContext);

    games.wordle = { signedIn: true, status: "WIN", daysAgo: 1 };
    await wordle.bringToFront();
    await wordle.reload();
    await wordle.waitForTimeout(6_000);
    await expect(wordle.locator("[data-scrim-toast]")).toHaveCount(0);
  });

  test("an unfinished game isn't submitted", async ({ extContext, games }) => {
    const crew = await createCrewApi(owner, "E2E Unfinished", ["wordle"]);
    const { wordle, scrim } = await setUp(extContext);

    games.wordle = { signedIn: true, status: "IN_PROGRESS" };
    await wordle.bringToFront();
    await wordle.reload();
    await wordle.waitForTimeout(5_000);
    await expect(wordle.locator("[data-scrim-toast]")).toHaveCount(0);

    await scrim.goto(`/crew/${crew.invite_code}`);
    await expect(scrim.locator(".game-card-summary")).toContainText("Your turn");
  });

  // 8.
  test("a game played before the crew picks it is submitted once it does", async ({ extContext, games }) => {
    const { wordle, scrim } = await setUp(extContext);

    // Play with no crew playing Wordle: the extension keeps the result.
    games.wordle = { signedIn: true, status: "WIN" };
    await wordle.bringToFront();
    await wordle.reload();
    await expect(toast(wordle)).toContainText("3/6 saved", { timeout: 20_000 });
    await expect(toast(wordle)).toContainText("None of your crews play this yet.");

    // Make a crew and pick Wordle.
    await scrim.bringToFront();
    await scrim.goto("/");
    await scrim.getByRole("button", { name: "Add a new crew" }).click();
    await scrim.getByRole("dialog").getByLabel("Crew name").fill("E2E Later Crew");
    await scrim.getByRole("button", { name: "Create crew" }).click();
    await expect(scrim.getByRole("heading", { level: 1, name: "E2E Later Crew" })).toBeVisible();
    await scrim.locator(".game-toggles").getByRole("button", { name: /^. Wordle$/ }).click();

    // The saved result lands in the new crew.
    await expect(board(scrim, "Wordle").locator("tr", { hasText: accounts.owner.name })).toContainText("3/6", {
      timeout: 25_000,
    });

    // Opening Wordle again: it's already in, so the extension stays quiet and nothing doubles up.
    await wordle.bringToFront();
    await wordle.reload();
    await wordle.waitForTimeout(5_000);
    await expect(wordle.locator("[data-scrim-toast]")).toHaveCount(0);

    await scrim.bringToFront();
    await scrim.reload();
    await expect(board(scrim, "Wordle").locator("tr", { hasText: accounts.owner.name })).toContainText("3/6");
  });

  test("the extension popup shows saved results", async ({ extContext, games }) => {
    await createCrewApi(owner, "E2E Popup Crew", ["wordle"]);
    const { wordle } = await setUp(extContext);
    games.wordle = { signedIn: true, status: "WIN" };
    await wordle.reload();
    await expect(toast(wordle)).toContainText("locked in", { timeout: 20_000 });

    const [worker] = extContext.serviceWorkers();
    const id = new URL(worker.url()).host;
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByText(`⚡ Connected as ${accounts.owner.name}`)).toBeVisible();
    await expect(popup.getByText(`Wordle #${todaysWordle().toLocaleString("en-US")} · 3/6`)).toBeVisible();
    await expect(popup.getByText("1 crew", { exact: true })).toBeVisible();
  });
});
