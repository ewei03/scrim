import { expect, test, type Page } from "@playwright/test";
import {
  NO_ACCOUNTS,
  accounts,
  createCrewApi,
  deleteOwnedCrews,
  hasAccounts,
  loginBrowser,
  expandGameCards,
  signIn,
  type Signed,
} from "./support/accounts";
import { wordleShareText } from "./support/games";

// 8. The crew's day rolling over at midnight: today's results move into the
// archive and the rankings take them in, without reloading the page.
//
// How it's faked. The server checks real time, and the tests can't change it,
// so results can only go into days that are still open. What closes a day on
// the page is the browser's clock (a round is "finished" once its closes_at has
// passed), and Playwright can set that.
//
// Two open days, for a crew with history: the crew runs on Pago Pago time
// (UTC-11, no daylight saving). There, today's and tomorrow's Wordles are both
// open on the server (it accepts any puzzle dated between UTC-12h and UTC+14h,
// and tomorrow in Pago Pago is always within that). So both players submit for
// both days, then the browser is set to 11:59pm at the end of the second day:
// the first day is history, the second is today. A minute later, it's midnight.

test.skip(!hasAccounts, NO_ACCOUNTS);

const ZONE = "Pacific/Pago_Pago";
const OFFSET_HOURS = -11;
const WORDLE_EPOCH = Date.UTC(2021, 5, 19);
const DAY = 86_400_000;

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

/** Today's date in the crew's zone, as midnight UTC of that date. */
function crewToday(): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date()).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Share text and result for a Wordle solved in `guesses`. */
function wordle(puzzle: number, guesses: number) {
  const grid = [...Array(guesses - 1).fill("g...."), "ggggg"];
  const tiles = grid.map((row) => [...row].map((c) => (c === "g" ? "🟩" : "⬛")).join("")).join("\n");
  return {
    raw: `${wordleShareText(puzzle).split("\n")[0].replace("3/6", `${guesses}/6`)}\n\n${tiles}`,
    result: { puzzle: String(puzzle), solved: true, guesses, hard: false, grid },
  };
}

async function submit(who: Signed, crewId: string, puzzle: number, guesses: number) {
  const { raw, result } = wordle(puzzle, guesses);
  const { error } = await who.client.rpc("submit_entry", {
    p_crew: crewId,
    p_game: "wordle",
    p_result: result,
    p_raw: raw,
    p_source: "paste",
  });
  expect(error, `submit Wordle #${puzzle}`).toBeNull();
}

const rankings = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: /^Rankings/ }) });
const rankingRow = (page: Page, name: string) => rankings(page).locator("tbody tr", { hasText: name });
// Days on the archive calendar that have results.
const archived = (page: Page) => page.locator(".archive-cal-day.has-results");
const wordleCard = (page: Page) => page.locator(".game-card", { hasText: "Wordle" });
const openTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();

test("at midnight, today's results move to the archive and the rankings update", async ({ page, context }) => {
  const crew = await createCrewApi(owner, "E2E Midnight", ["wordle"]);
  const { error } = await owner.client.rpc("update_crew_settings", { p_crew: crew.id, p_timezone: ZONE });
  expect(error).toBeNull();
  await friend.client.rpc("join_crew", { p_code: crew.invite_code });

  const today = crewToday();
  const day1 = Math.round((today - WORDLE_EPOCH) / DAY);
  const day2 = day1 + 1;
  // The owner wins both days (fewer guesses is better).
  await submit(owner, crew.id, day1, 3);
  await submit(friend, crew.id, day1, 5);
  await submit(owner, crew.id, day2, 2);
  await submit(friend, crew.id, day2, 4);

  // Midnight at the end of day 2, in the crew's zone.
  const midnight = today + 2 * DAY - OFFSET_HOURS * 3_600_000;
  await page.clock.install({ time: new Date(midnight - 60_000) }); // 11:59pm
  await loginBrowser(context, owner);
  await page.goto(`/crew/${crew.invite_code}`);
  await expandGameCards(page);

  // 11:59pm: day 1 is history, day 2 is still today.
  await expect(wordleCard(page)).toContainText(`#${day2.toLocaleString("en-US")}`);
  await expect(wordleCard(page).locator("tbody tr", { hasText: accounts.owner.name })).toContainText("2/6");
  await openTab(page, "Rankings");
  await expect(rankingRow(page, accounts.owner.name).locator("td").nth(3)).toHaveText("1"); // played
  await expect(rankingRow(page, accounts.owner.name).locator("td").nth(2)).toHaveText("1"); // wins
  await expect(rankingRow(page, accounts.friend.name).locator("td").nth(2)).toHaveText("0");
  await expect(archived(page)).toHaveCount(1);

  // Midnight. The page's clock ticks every 15s; two minutes covers it.
  await page.clock.fastForward("02:00");

  // Day 2 has moved to the archive and counts in the rankings.
  await expect(archived(page)).toHaveCount(2);
  const ownerRow = rankingRow(page, accounts.owner.name);
  await expect(ownerRow.locator("td").nth(0)).toHaveText("1"); // place
  await expect(ownerRow.locator("td").nth(2)).toHaveText("2"); // wins
  await expect(ownerRow.locator("td").nth(3)).toHaveText("2"); // played
  await expect(ownerRow.locator("td").nth(6)).toHaveText("2W"); // streak
  await expect(rankingRow(page, accounts.friend.name).locator("td").nth(2)).toHaveText("0");

  // And a new day has started, with nobody in it yet.
  await openTab(page, "Today");
  const day3 = day2 + 1;
  await expect(wordleCard(page)).toContainText(`#${day3.toLocaleString("en-US")}`);
  await expect(wordleCard(page).getByText(/Nobody has submitted yet/)).toBeVisible();
});
