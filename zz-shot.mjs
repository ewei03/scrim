import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1100, height: 1300 }, colorScheme: scheme });
  await p.goto("http://localhost:3000/");
  await p.getByRole("button", { name: "How Scrim works" }).click();
  await p.waitForTimeout(800);
  await p.locator("dialog[open]").screenshot({ path: `${out}/help-${scheme}.png` });
}
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto("http://localhost:3000/");
await m.getByRole("button", { name: "How Scrim works" }).click();
await m.waitForTimeout(800);
await m.screenshot({ path: `${out}/help-phone.png` });
await b.close();
