import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// The site's Supabase details, and the test accounts (see e2e/README.md).
for (const file of [".env.local", ".env.test.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// A separate Supabase project for the tests, so they don't make rows in the
// live one. Set both in .env.test.local; the tests and the site they start
// then use it (the test workers inherit this environment).
const testProject = Boolean(process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_PUBLISHABLE_KEY);
if (testProject) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.E2E_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
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
    // A dev server you already have running talks to the project in
    // .env.local. With a test project, start a fresh one (pointed at it);
    // stop yours first, or this fails with "port in use" rather than quietly
    // testing against the live project.
    reuseExistingServer: !testProject,
    // Values already in the environment win over .env.local in Next.js.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    timeout: 180_000,
  },
});
