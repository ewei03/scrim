// Renders the extension's icons (extension/icons/icon-<size>.png) from the
// favicon, src/app/icon.svg: the version of the logo made for small sizes
// (bigger S, bigger arrowheads). Run after changing the icon:
//
//   npm run ext:icons
//
// Uses Playwright's Chromium (already installed for the e2e tests).
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SIZES = [16, 32, 48, 128];
const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const out = new URL(`../extension/icons/icon-${size}.png`, import.meta.url);
    await page.locator("svg").screenshot({ path: out.pathname.replace(/^\/([A-Za-z]:)/, "$1"), omitBackground: true });
    console.log(`extension/icons/icon-${size}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
