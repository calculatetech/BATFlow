import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("starts empty, exposes the managed version, and has no serious axe violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.locator("#statusText")).toContainText("v0.5.1");
  await expect(page.locator("#statusText")).toContainText("development");
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
        "[MENU]\r\n" +
          "MENUITEM=TEST,Test configuration\r\n" +
          "MENUITEM=NORMAL,Normal configuration\r\n" +
          "MENUDEFAULT=TEST,5\r\n",
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

  const derivedDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const derivedDownload = await derivedDownloadPromise;
  const derivedStream = await derivedDownload.createReadStream();
  let derivedContent = "";
  for await (const chunk of derivedStream) derivedContent += chunk.toString();
  expect(
    JSON.parse(derivedContent).project.metadata.simulationScenario.variables,
  ).not.toHaveProperty("config");

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

  const interactionDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const interactionDownload = await interactionDownloadPromise;
  const interactionStream = await interactionDownload.createReadStream();
  let interactionContent = "";
  for await (const chunk of interactionStream)
    interactionContent += chunk.toString();
  expect(
    JSON.parse(interactionContent).project.metadata.simulationScenario
      .variables,
  ).not.toHaveProperty("config");

  await page.getByRole("button", { name: "CONFIG.SYS" }).click();
  await page.getByRole("tab", { name: "Source" }).click();
  await page
    .locator("#sourceView")
    .fill(
      "[MENU]\n" +
        "MENUITEM=TEST,Test configuration\n" +
        "MENUITEM=NORMAL,Normal configuration\n" +
        "MENUDEFAULT=NORMAL,5\n",
    );
  await page.getByRole("button", { name: "AUTOEXEC.BAT" }).click();
  await expect(page.locator('select[data-var="config"]')).toHaveValue("NORMAL");
  await page.locator('select[data-var="config"]').selectOption("__custom");
  await expect(page.locator('[data-custom="config"]')).toHaveValue("NORMAL");
  await page.locator('[data-custom="config"]').fill("CUSTOM");
  await expect(page.locator('select[data-var="config"]')).toHaveValue(
    "__custom",
  );
  await page.locator('[data-custom="config"]').fill("");
  await expect(page.locator('select[data-var="config"]')).toHaveValue("");
  await expect(
    page.locator(".trace-row").filter({ hasText: "%config%" }),
  ).toContainText("FALSE");
  await expect(page.locator("#traceSummary")).toContainText(
    "Exited interpreter",
  );
  await expect(page.locator("#appMessage")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator('select[data-var="config"]')).toHaveValue("");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset inputs" }).click();
  await expect(page.locator('select[data-var="config"]')).toHaveValue("NORMAL");

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

test("simulation inputs persist project-wide, export, import, and reset", async ({
  page,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles([
    {
      name: "MAIN.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          'if "%MODE%"=="SAFE" echo safe',
          "if exist C:\\TOOLS\\APP.EXE echo found",
          "choice /c:YN Continue",
          "if errorlevel 2 goto no",
          "exit",
          ":no",
          "exit",
          ":unused",
          'if "%constructor%"=="SAFE" echo hostile',
        ].join("\r\n"),
      ),
    },
    {
      name: "SECOND.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          'if "%OTHER%"=="ON" echo second',
          "if exist D:\\CACHE.DAT echo cached",
          "choice /c:YN Continue",
          "if errorlevel 2 goto no",
          "exit",
          ":no",
          "exit",
        ].join("\r\n"),
      ),
    },
  ]);

  await expect(page.locator('input[data-var="constructor"]')).toHaveValue("");
  await page.locator('input[data-var="mode"]').fill("SAFE");
  await page.locator("[data-path]").selectOption("yes");
  await page.locator("[data-outcome]").fill("2");
  await expect(page.locator("#traceSummary")).toContainText(
    "Exited interpreter",
  );
  await page.locator("[data-outcome]").fill("9999999999999999999999999999999");
  await expect(page.locator("#appMessage")).toContainText(
    "ERRORLEVEL must be an integer from 0 through 255",
  );
  await expect(page.locator("[data-outcome]")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("[data-outcome]")).toHaveValue("");
  await expect(page.locator("#traceSummary")).toContainText(
    /outcome required at line/i,
  );
  await expect(page.locator("#traceView")).not.toContainText(
    "Simulated ERRORLEVEL 2",
  );
  expect(pageErrors).toEqual([]);
  await page.locator("[data-outcome]").fill("2");
  await expect(page.locator("#traceView")).toContainText(
    "TRUE · ERRORLEVEL 2 >= 2",
  );

  await page.getByRole("button", { name: "SECOND.BAT" }).click();
  await page.locator('input[data-var="other"]').fill("ON");
  await page.locator("[data-path]").selectOption("no");
  await page.locator("[data-outcome]").fill("1");

  await page.getByRole("button", { name: "MAIN.BAT" }).click();
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("SAFE");
  await expect(page.locator("[data-path]")).toHaveValue("yes");
  await expect(page.locator("[data-outcome]")).toHaveValue("2");
  await page.getByRole("tab", { name: "Source" }).click();
  const source = await page.locator("#sourceView").inputValue();
  await page.locator("#sourceView").fill(`rem inserted\n${source}`);
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("SAFE");
  await expect(page.locator("[data-path]")).toHaveValue("yes");
  await expect(page.locator("[data-outcome]")).toHaveValue("2");
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.reload();
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("SAFE");
  await expect(page.locator("[data-path]")).toHaveValue("yes");
  await expect(page.locator("[data-outcome]")).toHaveValue("2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  const document = JSON.parse(content);
  expect(document.project.metadata.simulationScenario.variables).toEqual({
    mode: "SAFE",
    other: "ON",
  });
  expect(document.project.metadata.simulationScenario.paths).toEqual({
    "c:\\tools\\app.exe": "yes",
    "d:\\cache.dat": "no",
  });
  expect(
    Object.values(document.project.metadata.simulationScenario.outcomes).sort(),
  ).toEqual([1, 2]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "New project" }).click();
  await page.locator("#fileInput").setInputFiles({
    name: "scenario.batflow",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("SAFE");
  await expect(page.locator("[data-path]")).toHaveValue("yes");
  await expect(page.locator("[data-outcome]")).toHaveValue("2");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset inputs" }).click();
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("");
  await expect(page.locator("[data-path]")).toHaveValue("unknown");
  await expect(page.locator("[data-outcome]")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Reset inputs" }),
  ).toBeDisabled();
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "New project" }).click();
  await page.locator("#fileInput").setInputFiles({
    name: "FRESH.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      'if "%MODE%"=="SAFE" echo safe\r\n' +
        "if exist C:\\TOOLS\\APP.EXE echo found\r\n" +
        "choice /c:YN Continue\r\n" +
        "if errorlevel 2 goto no\r\nexit\r\n:no\r\nexit",
    ),
  });
  await expect(page.locator('input[data-var="mode"]')).toHaveValue("");
  await expect(page.locator("[data-path]")).toHaveValue("unknown");
  await expect(page.locator("[data-outcome]")).toHaveValue("");
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
  expect(document.createdBy.productVersion).toBe("0.5.1");

  await page.locator("#fileInput").setInputFiles({
    name: "broken.batflow",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":999,"project":{}}'),
  });
  await expect(page.locator("#appMessage")).toContainText("Import failed");
  await expect(page.getByRole("button", { name: "MAIN.BAT" })).toBeVisible();
});

test("repaired imports preserve successful and failed save status", async ({
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
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  const repairedDocument = JSON.parse(content);
  repairedDocument.project.metadata.simulationScenario.outcomes.oversized = 1e31;
  content = JSON.stringify(repairedDocument);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#fileInput").setInputFiles({
    name: "valid.batflow",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });
  await expect(page.locator("#appMessage")).toHaveText(
    "Saved · Project imported; cleared 1 out-of-range simulation outcome.",
  );
  await expect(page.locator("#appMessage")).toHaveClass(/success/);

  await page.evaluate(() => {
    globalThis.IDBObjectStore.prototype.put =
      function forceImportSaveFailure() {
        throw new DOMException("Forced test failure", "UnknownError");
      };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#fileInput").setInputFiles({
    name: "valid.batflow",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });

  await expect(page.locator("#appMessage")).toContainText(
    "Project imported; cleared 1 out-of-range simulation outcome.",
  );
  await expect(page.locator("#appMessage")).toContainText(
    "Save failed: Forced test failure",
  );
});

test("oversized stored outcomes are cleared without losing the project", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "RECOVER.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "choice Continue\r\nif errorlevel 2 goto no\r\nexit\r\n:no\r\nexit",
    ),
  });
  await page.locator("[data-outcome]").fill("2");
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = globalThis.indexedDB.open("batflow", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const request = store.get("current");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const document = request.result;
            const outcomes =
              document.project.metadata.simulationScenario.outcomes;
            outcomes[Object.keys(outcomes)[0]] = 1e31;
            store.put(document, "current");
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      }),
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "RECOVER.BAT" })).toBeVisible();
  await expect(page.locator("[data-outcome]")).toHaveValue("");
  await expect(page.locator("#appMessage")).toContainText(
    "Recovered project and cleared 1 out-of-range simulation outcome.",
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "RECOVER.BAT" })).toBeVisible();
  await expect(page.locator("#appMessage")).not.toContainText(
    "out-of-range simulation outcome",
  );
});
