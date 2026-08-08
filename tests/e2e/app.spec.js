import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("loads, simulates, edits, and keeps actions fixed", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.getByText("0.6.0", { exact: true })).toBeVisible();

  await page.locator("#fileInput").setInputFiles([
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "@echo off\r\nif exist C:\\NET goto network\r\necho Local\r\ngoto end\r\n:network\r\necho Network\r\n:end\r\necho Done\r\n",
      ),
    },
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "[menu]\r\nmenuitem=network,Network\r\n[network]\r\ndos=high\r\n",
      ),
    },
  ]);

  await expect(page.locator(".file-item")).toHaveCount(2);
  await expect(page.locator("#currentPath")).toContainText("entry");
  await expect(page.locator(".flow-node")).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fit graph" })).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const graphViolations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    return result.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact),
    );
  });
  expect(graphViolations).toEqual([]);
  if (testInfo.project.name === "firefox") {
    await expect(page).toHaveScreenshot("flow.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  }
  await page.locator(".flow-node.decision select").selectOption("yes");
  await page.getByRole("button", { name: "Executed code" }).click();
  await expect(page.locator(".executed-code")).toContainText("echo Network");
  await expect(page.locator(".executed-code")).not.toContainText("echo Local");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("#sourceEditor").fill("@echo off\nset MODE=TEST\n");
  await expect(page.locator("#currentPath")).toContainText("modified");
  await expect(page.locator("#sourceHighlight")).toContainText("MODE=TEST");
  await expect(page.locator("#downloadCurrent")).toBeEnabled();

  const pane = await page.locator(".command-pane").boundingBox();
  const actions = await page.locator(".session-actions").boundingBox();
  expect(actions.y + actions.height).toBeLessThanOrEqual(pane.y + pane.height);

  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    return result.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact),
    );
  });
  expect(violations).toEqual([]);
});

test("renders 2,000 lines within the desktop budget", async ({ page }) => {
  await page.goto("/");
  const source = Array.from(
    { length: 2000 },
    (_, index) => `echo line ${index + 1}`,
  ).join("\r\n");
  const start = await page.evaluate(() => performance.now());
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(page.locator(".flow-node.process")).toBeVisible();
  const elapsed = await page.evaluate(
    (value) => performance.now() - value,
    start,
  );
  expect(elapsed).toBeLessThan(2000);
  const measures = await page.evaluate(() =>
    Object.fromEntries(
      [
        "batflow:program",
        "batflow:layout",
        "batflow:render",
        "batflow:simulate",
      ].map((name) => [
        name,
        performance.getEntriesByName(name).at(-1)?.duration,
      ]),
    ),
  );
  for (const duration of Object.values(measures)) {
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(1000);
  }
});
