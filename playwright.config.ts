import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: ".scratch/ci/playwright/results",
  reporter: [
    ["line"],
    ["html", { outputFolder: ".scratch/ci/playwright/report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
