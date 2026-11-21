import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// The site's Supabase details, and the test accounts (see e2e/README.md).
for (const file of [".env.local", ".env.test.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "e2e",
  // Tests share real accounts on a real Supabase project, so one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    // localhost, not 127.0.0.1: Google sign-in only accepts registered origins.
    baseURL: `http://localhost:${PORT}`,
    // Watch the tests run. E2E_HEADLESS=1 hides the browser; E2E_SLOWMO=300 slows each step.
    headless: process.env.E2E_HEADLESS === "1",
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
    viewport: { width: 1280, height: 860 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
