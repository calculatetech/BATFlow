import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("starts empty, exposes the managed version, and has no serious axe violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.locator("#statusText")).toContainText("v0.5.0");
  await expect(page.locator("#statusText")).toContainText("candidate 4");
  await expect(page.getByText("No file selected.").first()).toBeVisible();

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

test("imports, recalculates traces after editing, persists, and confirms replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles([
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "@echo off",
          "",
          'if "%config%"=="test" echo configured',
          "choice /c:YN Continue",
          "if errorlevel 2 goto no",
          "goto yes",
          ":no",
          "exit",
          ":yes",
          "exit",
        ].join("\r\n"),
      ),
    },
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "[MENU]\r\nMENUITEM=TEST,Test configuration\r\nMENUDEFAULT=TEST,5\r\n",
      ),
    },
  ]);

  await expect(
    page.getByRole("button", { name: "AUTOEXEC.BAT" }),
  ).toBeVisible();
  await expect(page.locator('select[data-var="config"]')).toHaveValue("TEST");
  await expect(
    page.locator('select[data-var="config"] option[value="TEST"]'),
  ).toHaveText("TEST");
  await expect(page.locator(".kind-blank")).toHaveCount(0);
  await expect(page.locator("[data-outcome]")).toHaveCount(1);
  await expect(page.locator("#traceSummary")).toContainText(
    "outcome required",
    {
      ignoreCase: true,
    },
  );
  await expect(page.locator("#traceSummary")).not.toContainText(
    "Input required at line 2",
  );

  await page.getByRole("tab", { name: "Split" }).click();
  await page.locator(".block").filter({ hasText: "choice /c:YN" }).click();
  const selectedSource = await page
    .locator("#sourceView")
    .evaluate((source) =>
      source.value.slice(source.selectionStart, source.selectionEnd),
    );
  expect(selectedSource).toContain("choice /c:YN");

  await page.getByRole("tab", { name: "Execution trace" }).click();
  await expect(
    page.locator(".trace-row").filter({ hasText: "%config%" }),
  ).toContainText("TRUE");

  await page.locator("[data-outcome]").fill("2");
  await expect(page.locator("#traceSummary")).toContainText(
    "Exited interpreter",
  );

  await page.getByRole("tab", { name: "Source" }).click();
  await page.locator("#sourceView").fill("echo replaced\r\nexit");
  await expect(page.locator("#traceSummary")).toContainText(
    "Exited interpreter",
  );
  await expect(page.locator("[data-outcome]")).toHaveCount(0);
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.reload();
  await expect(page.locator("#sourceView")).toHaveValue("echo replaced\nexit");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "New project" }).click();
  await expect(
    page.getByRole("button", { name: "AUTOEXEC.BAT" }),
  ).toBeVisible();
});

test("exports a versioned project and rejects invalid import without replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "MAIN.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo safe\r\nexit"),
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Untitled.batflow");
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  const document = JSON.parse(content);
  expect(document.formatVersion).toBe(1);
  expect(document.createdBy.productVersion).toBe("0.5.0");

  await page.locator("#fileInput").setInputFiles({
    name: "broken.batflow",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":999,"project":{}}'),
  });
  await expect(page.locator("#appMessage")).toContainText("Import failed");
  await expect(page.getByRole("button", { name: "MAIN.BAT" })).toBeVisible();
});
