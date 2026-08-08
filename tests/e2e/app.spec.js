import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("loads, edits, switches views, and exposes fixed session actions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.getByText("0.6.0 development")).toBeVisible();

  await page.locator("#fileInput").setInputFiles([
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from("@echo off\r\nif exist C:\\NET goto network\r\n"),
    },
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from("[menu]\r\nmenuitem=network,Network\r\n"),
    },
  ]);

  await expect(page.locator(".file-item")).toHaveCount(2);
  await expect(page.locator("#currentPath")).toContainText("entry");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("#sourceEditor").fill("@echo off\nset MODE=TEST\n");
  await expect(page.locator("#currentPath")).toContainText("modified");
  await expect(page.locator("#sourceHighlight")).toContainText("MODE=TEST");
  await expect(page.locator("#downloadCurrent")).toBeEnabled();

  const pane = await page.locator(".command-pane").boundingBox();
  const actions = await page.locator(".session-actions").boundingBox();
  expect(actions.y + actions.height).toBeLessThanOrEqual(pane.y + pane.height);

  await page.addScriptTag({ path: axePath });
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
