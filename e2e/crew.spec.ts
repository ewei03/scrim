import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  NO_ACCOUNTS,
  accounts,
  createCrewApi,
  deleteOwnedCrews,
  hasAccounts,
  newGuest,
  signIn,
  loginBrowser,
  type Signed,
} from "./support/accounts";

// 4. Create a crew, invite people, change its settings and pick its games.
// 5. Delete a crew.

test.skip(!hasAccounts, NO_ACCOUNTS);

let owner: Signed;
let friend: Signed;

test.beforeEach(async () => {
  owner = await signIn("owner");
  friend = await signIn("friend");
});

test.afterEach(async () => {
  await deleteOwnedCrews(owner);
});

/** A second person, in their own browser window. */
async function openAs(context: BrowserContext, signed: Signed) {
  await loginBrowser(context, signed);
  return context.newPage();
}

async function createCrewInUi(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("New crew name").fill(name);
  await page.getByRole("button", { name: "Create crew" }).click();
  await expect(page).toHaveURL(/\/crew\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function openManage(page: Page) {
  await page.getByRole("button", { name: "Manage crew" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage crew" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const memberChips = (page: Page) => page.locator(".member-chips li");

test("create a crew and invite a friend and a guest", async ({ page, context, browser }) => {
  await loginBrowser(context, owner);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createCrewInUi(page, "E2E Invite Crew");

  // New crews start with no games and the owner as the only member.
  await expect(page.getByText("1 member", { exact: true })).toBeVisible();
  await expect(memberChips(page)).toHaveText([accounts.owner.name]);
  await expect(page.getByText("Click on a game in the Crew tab to get started.")).toBeVisible();

  // The invite button copies the crew's link.
  await page.getByRole("button", { name: "⧉ Invite to crew" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toMatch(/^http:\/\/localhost:\d+\/crew\/[\w-]+$/);
  expect(invite).toBe(page.url());

  // A friend opens the link and is in.
  const friendContext = await browser.newContext();
  const friendPage = await openAs(friendContext, friend);
  await friendPage.goto(invite);
  await expect(friendPage.getByRole("heading", { level: 1, name: "E2E Invite Crew" })).toBeVisible();
  await expect(memberChips(friendPage)).toHaveText([accounts.owner.name, accounts.friend.name]);
  // Members who don't own the crew can leave, but not manage it.
  await expect(friendPage.getByRole("button", { name: "Leave" })).toBeVisible();
  await expect(friendPage.getByRole("button", { name: "Manage crew" })).toHaveCount(0);

  // So can a guest, who's marked as one.
  const guestContext = await browser.newContext();
  const guestPage = await openAs(guestContext, await newGuest("E2E Guest"));
  await guestPage.goto(invite);
  await expect(memberChips(guestPage)).toHaveCount(3);
  await expect(guestPage.getByText("You're playing as a guest", { exact: false })).toBeVisible();

  // The owner sees them arrive without reloading (the page refreshes itself), or on Refresh.
  await page.getByRole("button", { name: "↻ Refresh" }).click();
  await expect(page.getByText("3 members", { exact: true })).toBeVisible();
  await expect(memberChips(page).filter({ hasText: "E2E Guest" })).toContainText("(guest)");

  // The crew is on everyone's home page.
  await friendPage.goto("/");
  await expect(friendPage.locator(".crew-card", { hasText: "E2E Invite Crew" })).toContainText("3 members");

  await friendContext.close();
  await guestContext.close();
});

test("a name that's already in the crew can't join it", async ({ page, context, browser }) => {
  const crew = await createCrewApi(owner, "E2E Name Clash");
  const guestContext = await browser.newContext();
  // A guest with the owner's name.
  const clash = await openAs(guestContext, await newGuest(accounts.owner.name));
  await clash.goto(`/crew/${crew.invite_code}`);
  await expect(clash.getByText(/already/i)).toBeVisible();
  await expect(memberChips(clash)).toHaveCount(0);
  await guestContext.close();

  // The crew still has just its owner.
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  await expect(page.getByText("1 member", { exact: true })).toBeVisible();
});

test("change the crew's settings", async ({ page, context, browser }) => {
  const crew = await createCrewApi(owner, "E2E Settings Crew");
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });

  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  let dialog = await openManage(page);

  // Rename.
  const rename = dialog.getByRole("button", { name: "Rename" });
  await expect(rename).toBeDisabled(); // nothing changed yet
  await dialog.getByLabel("Crew name").fill("E2E Renamed Crew");
  await rename.click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E Renamed Crew" })).toBeVisible();

  // Hide scores until you submit.
  const hide = dialog.getByLabel("Hide scores until you submit (no spoilers)");
  const hidden = await hide.isChecked();
  await hide.click();
  await expect(hide).toBeChecked({ checked: !hidden });

  // Time zone: pick a different one.
  const zone = dialog.getByLabel("Time Zone");
  const current = await zone.inputValue();
  const other = await zone.locator("option").evaluateAll(
    (options, cur) => (options as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== cur && v.startsWith("Pacific/")),
    current,
  );
  await zone.selectOption(other!);
  await expect(zone).toHaveValue(other!);
  await expect(zone).toBeEnabled(); // saved

  // Everything sticks after a reload.
  await page.reload();
  dialog = await openManage(page);
  await expect(dialog.getByLabel("Crew name")).toHaveValue("E2E Renamed Crew");
  await expect(dialog.getByLabel("Hide scores until you submit (no spoilers)")).toBeChecked({ checked: !hidden });
  await expect(dialog.getByLabel("Time Zone")).toHaveValue(other!);

  // The manage window closes with × and with a click outside.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  dialog = await openManage(page);
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();

  // Remove a member.
  dialog = await openManage(page);
  await expect(dialog.locator(".manage-members li")).toHaveText([`${accounts.friend.name}Remove`]);
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(dialog.getByText("No other members yet.")).toBeVisible();

  // The friend sees the crew's gone for them.
  const friendContext = await browser.newContext();
  const friendPage = await openAs(friendContext, friend);
  await friendPage.goto("/");
  await expect(friendPage.locator(".crew-card", { hasText: "E2E Renamed Crew" })).toHaveCount(0);
  await friendContext.close();
});

test("pick the crew's games, including a custom one", async ({ page, context, browser }) => {
  const crew = await createCrewApi(owner, "E2E Games Crew");
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);

  const toggle = (name: string) => page.locator(".game-toggles").getByRole("button", { name: new RegExp(`^. ${name}$`) });
  const todayCard = (name: string) => page.locator(".game-card", { hasText: name });

  // Turn on Wordle and Connections: each shows up under Today, open.
  for (const game of ["Wordle", "Connections"]) {
    await expect(toggle(game)).toHaveAttribute("aria-pressed", "false");
    await toggle(game).click();
    await expect(toggle(game)).toHaveAttribute("aria-pressed", "true");
    await expect(todayCard(game)).toBeVisible();
    await expect(todayCard(game).getByRole("button", { name: new RegExp(game) })).toHaveAttribute("aria-expanded", "true");
  }

  // Collapse and expand a game.
  const wordleHeader = todayCard("Wordle").locator(".game-card-toggle");
  await wordleHeader.click();
  await expect(wordleHeader).toHaveAttribute("aria-expanded", "false");
  await expect(todayCard("Wordle")).toContainText("Your turn · 0 played");
  await wordleHeader.click();
  await expect(wordleHeader).toHaveAttribute("aria-expanded", "true");

  // Turn Connections off again (after confirming).
  page.once("dialog", (d) => d.dismiss());
  await toggle("Connections").click();
  await expect(toggle("Connections")).toHaveAttribute("aria-pressed", "true"); // cancelled: still on
  page.once("dialog", (d) => d.accept());
  await toggle("Connections").click();
  await expect(toggle("Connections")).toHaveAttribute("aria-pressed", "false");
  await expect(todayCard("Connections")).toHaveCount(0);

  // A custom game. Clicking outside its window doesn't close it (and lose what's typed).
  await page.locator(".game-toggles").getByRole("button", { name: /Custom$/ }).click();
  const form = page.getByRole("dialog", { name: "Add a custom game" });
  await expect(form.getByText("Scores will be entered manually.")).toBeVisible();
  await form.getByLabel("Name", { exact: true }).fill("E2E Mini");
  await page.mouse.click(8, 8);
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("E2E Mini");

  await form.getByText("Time", { exact: true }).click();
  await expect(form.getByText("Lowest time wins")).toBeVisible();
  await expect(form.getByLabel("Lowest time wins")).toBeChecked();
  await expect(form).toContainText("Scores will look like 4:05");
  await form.getByRole("button", { name: "Add game" }).click();
  await expect(form).toBeHidden();
  await expect(toggle("E2E Mini")).toHaveAttribute("aria-pressed", "true");
  await expect(todayCard("E2E Mini")).toBeVisible();

  // The friend sees the crew's games, but can't change them.
  const friendContext = await browser.newContext();
  const friendPage = await openAs(friendContext, friend);
  await friendPage.goto(`/crew/${crew.invite_code}`);
  await expect(friendPage.locator(".crew-games .game-tag")).toHaveText(["Wordle", "E2E Mini"]);
  await expect(friendPage.locator(".game-toggles button")).toHaveCount(0);
  await friendContext.close();
});

test("delete a crew", async ({ page, context, browser }) => {
  const crew = await createCrewApi(owner, "E2E Doomed Crew", ["wordle"]);
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);

  // Cancelling the confirmation keeps it.
  let dialog = await openManage(page);
  page.once("dialog", (d) => {
    expect(d.message()).toContain("Delete E2E Doomed Crew for everyone?");
    return d.dismiss();
  });
  await dialog.getByRole("button", { name: "Delete crew" }).click();
  await expect(dialog).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "E2E Doomed Crew" })).toBeVisible();

  // Confirming deletes it and goes home.
  dialog = await openManage(page);
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Delete crew" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await expect(page.locator(".crew-card", { hasText: "E2E Doomed Crew" })).toHaveCount(0);

  // It's gone for the friend too, and the invite link no longer works.
  const friendContext = await browser.newContext();
  const friendPage = await openAs(friendContext, friend);
  await friendPage.goto("/");
  await expect(friendPage.getByRole("heading", { name: "Your crews" })).toBeVisible();
  await expect(friendPage.locator(".crew-card", { hasText: "E2E Doomed Crew" })).toHaveCount(0);
  await friendPage.goto(`/crew/${crew.invite_code}`);
  await expect(friendPage.getByText("Crew not found")).toBeVisible();
  await friendContext.close();
});

test("a member can leave a crew", async ({ page, context }) => {
  const crew = await createCrewApi(owner, "E2E Leaving Crew");
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });
  await loginBrowser(context, friend);
  await page.goto(`/crew/${crew.invite_code}`);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".crew-card", { hasText: "E2E Leaving Crew" })).toHaveCount(0);
});
