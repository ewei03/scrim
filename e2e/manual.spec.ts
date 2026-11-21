import { expect, test, type Page } from "@playwright/test";
import {
  NO_ACCOUNTS,
  accounts,
  createCrewApi,
  deleteOwnedCrews,
  hasAccounts,
  signIn,
  loginBrowser,
  type Signed,
} from "./support/accounts";
import { todaysWordle, wordleShareText } from "./support/games";

// 7. Submitting by pasting the game's share text (no extension), and typing
// in a custom game's score.

test.skip(!hasAccounts, NO_ACCOUNTS);

let owner: Signed;
let friend: Signed;
test.beforeEach(async () => {
  owner = await signIn("owner");
  friend = await signIn("friend");
  await deleteOwnedCrews(owner);
});
test.afterEach(async () => {
  await deleteOwnedCrews(owner);
});

const card = (page: Page, game: string) => page.locator(".game-card", { hasText: game });

async function openPasteBox(page: Page) {
  const wordle = card(page, "Wordle");
  await wordle.getByRole("button", { name: /paste your result/ }).click();
  return { box: wordle.locator("textarea"), lock: wordle.getByRole("button", { name: "Lock it in" }), wordle };
}

test("pasted results are checked, and a good one is locked in", async ({ page, context }) => {
  const crew = await createCrewApi(owner, "E2E Paste Crew", ["wordle"]);
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);

  // No extension in this browser: it says so, and offers pasting instead.
  await expect(card(page, "Wordle")).toContainText("Enable the Scrim extension");
  const { box, lock, wordle } = await openPasteBox(page);
  await expect(lock).toBeDisabled();

  const n = todaysWordle();
  const invalid = [
    // Shortcodes and a single square aren't a real result.
    `Wordle ${n.toLocaleString("en-US")} 4/6 :green_square:`,
    "hello there",
    // The grid has to match the score.
    `Wordle ${n.toLocaleString("en-US")} 4/6\n\n🟩🟩🟩🟩🟩`,
    // A win has to end on five greens.
    `Wordle ${n.toLocaleString("en-US")} 2/6\n\n🟩⬛⬛⬛⬛\n🟩🟩🟩🟨⬛`,
  ];
  for (const text of invalid) {
    await box.fill(text);
    await expect(wordle.locator(".error").first()).toBeVisible();
    await expect(lock).toBeDisabled();
  }

  // Yesterday's puzzle isn't today's.
  await box.fill(wordleShareText(n - 1));
  await expect(wordle.getByText(/but today's is/)).toBeVisible();
  await expect(lock).toBeDisabled();

  // Today's, done properly: a preview, then lock it in.
  await box.fill(wordleShareText(n));
  await expect(wordle.locator(".error")).toHaveCount(0);
  await expect(wordle.locator(".preview .score")).toHaveText("3/6");
  await lock.click();

  const row = wordle.locator("table.scoreboard tbody tr", { hasText: accounts.owner.name });
  await expect(row).toContainText("3/6");
  // One submission per puzzle: the paste box is gone.
  await expect(wordle.locator("textarea")).toHaveCount(0);

  // The home page shows it as done.
  await page.goto("/");
  await expect(page.locator(".pill-done").first()).toBeVisible();
});

test("hidden scores stay hidden until you submit yours", async ({ page, context, browser }) => {
  const crew = await createCrewApi(owner, "E2E Spoiler Crew", ["wordle"]);
  await owner.client.rpc("update_crew_settings", { p_crew: crew.id, p_hide_until_submitted: true });
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });

  // The owner pastes a result.
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  const { box, lock } = await openPasteBox(page);
  await box.fill(wordleShareText());
  await lock.click();
  await expect(card(page, "Wordle").locator("tbody tr", { hasText: accounts.owner.name })).toContainText("3/6");

  // The friend sees that the owner played, but not the score.
  const friendContext = await browser.newContext();
  await loginBrowser(friendContext, friend);
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`/crew/${crew.invite_code}`);
  const ownerRow = card(friendPage, "Wordle").locator("tbody tr", { hasText: accounts.owner.name });
  await expect(ownerRow.getByText("Hidden")).toBeVisible();
  await expect(ownerRow).toContainText("Submit yours to see");
  await expect(ownerRow).not.toContainText("3/6");

  // Once the friend submits, both show.
  const friendBox = await openPasteBox(friendPage);
  await friendBox.box.fill(wordleShareText());
  await friendBox.lock.click();
  await expect(ownerRow).toContainText("3/6");
  await friendContext.close();
});

test("the crew owner can void an entry so it can be submitted again", async ({ page, context }) => {
  const crew = await createCrewApi(owner, "E2E Void Crew", ["wordle"]);
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  const { box, lock, wordle } = await openPasteBox(page);
  await box.fill(wordleShareText());
  await lock.click();
  const row = wordle.locator("tbody tr", { hasText: accounts.owner.name });
  await expect(row).toContainText("3/6");

  page.once("dialog", (d) => d.accept());
  await row.getByTitle("Void this entry").click();
  await expect(wordle.getByText(/Nobody has submitted yet/)).toBeVisible();
  await expect(wordle.getByRole("button", { name: /paste your result/ })).toBeVisible();
});

test("custom game scores are typed in and checked", async ({ page, context }) => {
  const crew = await createCrewApi(owner, "E2E Custom Crew");
  const { error } = await owner.client.rpc("create_custom_game", {
    p_crew: crew.id,
    p_settings: {
      name: "E2E Sprint",
      url: null,
      instructions: "Enter your time from the results screen",
      color: "#5aa9e6",
      score_type: "time",
      higher_is_better: false,
      decimals: 0,
      unit: null,
      time_format: "m:ss",
      max_attempts: null,
      allow_fail: true,
    },
  });
  expect(error).toBeNull();

  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  const sprint = card(page, "E2E Sprint");
  await expect(sprint).toContainText("Enter your time from the results screen");
  const input = sprint.getByLabel("Your E2E Sprint score");
  const lock = sprint.getByRole("button", { name: "Lock it in" });

  for (const bad of ["abc", "4:75", "0"]) {
    await input.fill(bad);
    await expect(sprint.getByText("Enter a time like 4:05.")).toBeVisible();
    await expect(lock).toBeDisabled();
  }

  await input.fill("4:05");
  await expect(sprint.getByText("Shows as")).toContainText("4:05");
  await lock.click();
  await expect(sprint.locator("tbody tr", { hasText: accounts.owner.name })).toContainText("4:05");
});
