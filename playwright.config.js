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
    command: "python3 -m http.server 41740 --bind 127.0.0.1 --directory public",
    url: "http://127.0.0.1:41740",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
