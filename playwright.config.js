import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".agent/test-results/playwright",
  reporter: [
    ["line"],
    [
      "html",
      {
        outputFolder: ".agent/test-results/playwright-report",
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:41740",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:41740",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
    },
  ],
});
