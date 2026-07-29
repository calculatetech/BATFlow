import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

async function importFiles(page, files) {
  await page.locator("#fileInput").setInputFiles(files);
  await expect(page.locator("#confirmImport")).toBeEnabled();
  await page.locator("#confirmImport").click();
  await expect(page.locator("#importDialog")).not.toBeVisible();
}

async function createNewProject(page, name = "Untitled") {
  await page.getByRole("button", { name: "New project" }).click();
  await page.locator("#newProjectName").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator("#newProjectDialog")).not.toBeVisible();
}

async function downloadJson(page, buttonName) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  return { content, download, document: JSON.parse(content) };
}

async function waitForOfflineShell(page) {
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");
  await page.waitForFunction(() =>
    Boolean(globalThis.navigator.serviceWorker?.controller),
  );
}

test("starts empty, exposes the managed version, and has no serious axe violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.locator("#statusText")).toContainText("v0.5.4");
  await expect(page.locator("#statusText")).toContainText("development");
  await expect(page.getByText("No file selected.").first()).toBeVisible();
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Healthy");
  await page.getByRole("button", { name: "Diagnostics: Healthy" }).click();
  await expect(page.getByRole("dialog", { name: "Diagnostics" })).toBeVisible();
  await expect(page.locator("#diagnosticsOverall")).toContainText("Healthy");
  await expect(page.locator("#diagnosticsSaveState")).toHaveText("Idle");
  await expect(page.locator("#diagnosticsLastSave")).toHaveText(
    "Not observed this session",
  );
  await expect(page.locator("#diagnosticsVersions")).toContainText("0.5.4");
  await expect(page.locator("#diagnosticsVersions")).toContainText(
    "Project format",
  );
  await expect(page.locator("#diagnosticsVersions")).toContainText(
    "msdos-7.1-command.com",
  );
  await expect(page.locator("#diagnosticsVersions")).toContainText(
    "0.5.4-dev.7",
  );
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");
  await expect(page.locator("#diagnosticsDurabilityState")).toHaveText(
    /Persistent|Best effort|Unsupported|Unknown/,
  );

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
  await page.getByRole("button", { name: "Close" }).click();
});

test("reloads and saves the current project offline after the shell is cached", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await waitForOfflineShell(page);
  await importFiles(page, {
    name: "OFFLINE.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo online\r\nexit"),
  });
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await context.addCookies([
    {
      name: "batflow-test-offline",
      value: "1",
      url: "http://127.0.0.1:41740",
    },
  ]);
  await page.evaluate(() => {
    globalThis.navigator.serviceWorker.controller.postMessage({
      type: "BATFLOW_STATUS_REQUEST",
    });
  });
  await expect(page.locator("#offlineStatus")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "OFFLINE.BAT" })).toBeVisible();
  await expect(page.locator("#offlineStatus")).toBeVisible();
  await page.getByRole("tab", { name: "Source" }).click();
  await page.locator("#sourceView").fill("echo edited offline\r\nexit");
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await context.clearCookies();
  await expect(page.locator("#offlineStatus")).toBeHidden();
  await page.reload();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator("#sourceView")).toHaveValue(
    "echo edited offline\nexit",
  );
});

test("the complete offline shell is scope-relative under a deployment subpath", async ({
  page,
}) => {
  await page.goto("/batflow/");
  await waitForOfflineShell(page);
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  expect(
    await page.evaluate(
      () => globalThis.navigator.serviceWorker.controller.scriptURL,
    ),
  ).toContain("/batflow/service-worker.js");
});

test("an available update reloads only after the current project saves", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const activated = sessionStorage.getItem("batflow:test-update") === "1";
    const container = new EventTarget();
    const worker = new EventTarget();
    worker.state = "installed";
    worker.postMessage = (message) => {
      if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowActivationCount += 1;
        sessionStorage.setItem("batflow:test-update", "1");
        registration.waiting = null;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    const active = {
      postMessage() {},
    };
    const registration = new EventTarget();
    registration.active = active;
    registration.installing = null;
    registration.waiting = activated ? null : worker;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowActivationCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await importFiles(page, {
    name: "UPDATE.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo retained\r\nexit"),
  });
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.evaluate(() => {
    globalThis.__batflowOriginalPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function failUpdateSave() {
      throw new DOMException("Forced update save failure", "UnknownError");
    };
  });
  await page.getByRole("button", { name: "Update ready" }).click();
  await expect(page.locator("#appMessage")).toContainText("Update not applied");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  expect(await page.evaluate(() => globalThis.__batflowActivationCount)).toBe(
    0,
  );

  await page.evaluate(() => {
    globalThis.IDBObjectStore.prototype.put = globalThis.__batflowOriginalPut;
  });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Update ready" }).click(),
  ]);
  await expect(page.getByRole("button", { name: "UPDATE.BAT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update ready" })).toBeHidden();
});

for (const asset of ["app.js", "lib/diagnostics.js"]) {
  test(`reports a startup failure when ${asset} cannot load`, async ({
    page,
  }) => {
    await page.route(`**/${asset}?*`, (route) => route.abort());
    await page.goto("/");

    await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");
    await page.getByRole("button", { name: "Diagnostics: Error" }).click();
    await expect(
      page.getByRole("dialog", { name: "Diagnostics" }),
    ).toBeVisible();
    await expect(page.locator("#diagnosticsOverall")).toContainText(
      "BATFlow could not start",
    );
    await expect(page.locator("#diagnosticsEvents")).toContainText(
      "runtime.asset.failed",
    );
    await expect(page.locator("#diagnosticsEvents")).toContainText("app.js");
    await page.getByRole("button", { name: "Close" }).click();
  });
}

test("fallback diagnostics preserve early runtime error codes and details", async ({
  browserName,
  page,
}) => {
  await page.addInitScript(() => {
    globalThis.addEventListener("DOMContentLoaded", () => {
      throw new Error("EARLY-RUNTIME-DETAIL");
    });
  });
  await page.route("**/app.js?*", (route) => route.abort());
  await page.goto("/");

  await page.getByRole("button", { name: "Diagnostics: Error" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "runtime.error",
  );
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    browserName === "webkit" ? "Script error." : "EARLY-RUNTIME-DETAIL",
  );
});

test("imports, recalculates traces after editing, persists, and confirms replacement", async ({
  page,
}) => {
  await page.goto("/");
  await importFiles(page, [
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

  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.locator("#newProjectDialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
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
  await importFiles(page, [
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

  await createNewProject(page);
  await importFiles(page, {
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

  await createNewProject(page);
  await importFiles(page, {
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
  await importFiles(page, {
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
  expect(document.formatVersion).toBe(2);
  expect(document.createdBy.productVersion).toBe("0.5.4");

  await page.locator("#fileInput").setInputFiles({
    name: "broken.batflow",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":999,"project":{}}'),
  });
  await expect(page.locator("#appMessage")).toContainText("Import failed");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "MAIN.BAT" })).toBeVisible();
});

test("repaired imports preserve successful and failed save status", async ({
  page,
}) => {
  await page.goto("/");
  await importFiles(page, {
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

  await importFiles(page, {
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
  await importFiles(page, {
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

test("diagnostics track saves across reload and export only redacted context", async ({
  page,
}) => {
  await page.goto("/");
  await createNewProject(page, "SECRET PROJECT");
  await importFiles(page, {
    name: "SECRET.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "echo PRIVATE-SOURCE\r\nchoice PRIVATE-SIMULATION-VALUE\r\nexit",
    ),
  });
  await page.locator(".block").first().click();
  await page.locator("#editNote").fill("PRIVATE-NOTE");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("tab", { name: "Source" }).click();
  await page
    .locator("#sourceView")
    .fill(
      "echo PRIVATE-SOURCE-EDITED\r\nchoice PRIVATE-SIMULATION-VALUE\r\nexit",
    );
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Saving");
  await expect(page.locator("#appMessage")).toHaveText("Saved");
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Healthy");

  await page.getByRole("button", { name: "Diagnostics: Healthy" }).click();
  await expect(page.locator("#diagnosticsSaveState")).toHaveText("Saved");
  await expect(page.locator("#diagnosticsLastSave")).not.toHaveText(
    "Not observed this session",
  );
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "project.import.succeeded",
  );

  const exported = await downloadJson(page, "Export diagnostics");
  expect(exported.download.suggestedFilename()).toMatch(
    /^batflow-diagnostics-\d{8}-\d{6}Z\.json$/,
  );
  expect(exported.document.diagnosticsFormatVersion).toBe(2);
  expect(exported.document.createdBy.productVersion).toBe("0.5.4");
  expect(exported.document.versionDomains).toEqual({
    projectFormat: 2,
    indexedDbSchema: 1,
    interpreterProfile: "msdos-7.1-command.com",
    offlineShell: "0.5.4-dev.7",
  });
  expect(exported.document.runtime.offlineCache).toBe("ready");
  expect(["persistent", "best-effort", "unsupported", "unknown"]).toContain(
    exported.document.runtime.storageDurability,
  );
  expect(exported.document.counts.files).toBe(1);
  for (const secret of [
    "SECRET PROJECT",
    "SECRET.BAT",
    "PRIVATE-SOURCE",
    "PRIVATE-NOTE",
    "PRIVATE-SIMULATION-VALUE",
  ]) {
    expect(exported.content).not.toContain(secret);
  }
  await page.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Healthy");
  await page.getByRole("button", { name: "Diagnostics: Healthy" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "project.import.succeeded",
  );
  await expect(page.locator("#diagnosticsLastSave")).not.toHaveText(
    "Not observed this session",
  );
});

test("diagnostics retain save failures until recovery", async ({ page }) => {
  await page.goto("/");
  await importFiles(page, {
    name: "MAIN.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo original\r\nexit"),
  });
  await page.getByRole("tab", { name: "Source" }).click();
  await page.evaluate(() => {
    globalThis.__batflowOriginalPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function forceSaveFailure() {
      throw new DOMException("Forced diagnostics failure", "UnknownError");
    };
  });
  await page.locator("#sourceView").fill("echo failed save\r\nexit");
  await expect(page.locator("#appMessage")).toContainText("Save failed");
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");

  await page.locator("#fileInput").setInputFiles({
    name: "invalid.batflow",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":999,"project":{}}'),
  });
  await expect(page.locator("#appMessage")).toContainText("Import failed");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");
  await page.getByRole("button", { name: "Diagnostics: Error" }).click();
  await expect(page.locator("#diagnosticsOverall")).toContainText(
    "Forced diagnostics failure",
  );
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "storage.save.failed",
  );
  await page.getByRole("button", { name: "Close" }).click();

  await page.evaluate(() => {
    globalThis.IDBObjectStore.prototype.put = globalThis.__batflowOriginalPut;
  });
  await page.locator("#sourceView").fill("echo recovered save\r\nexit");
  await expect(page.locator("#appMessage")).toHaveText("Saved");
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Healthy");
  await page.getByRole("button", { name: "Diagnostics: Healthy" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "storage.save.failed",
  );
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "storage.save.recovered",
  );
});

test("runtime errors are captured and clearing history preserves active health", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    globalThis.setTimeout(() => {
      throw new Error("LOCAL-RUNTIME-DETAIL");
    }, 0);
  });
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");
  await page.getByRole("button", { name: "Diagnostics: Error" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "runtime.error",
  );
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "LOCAL-RUNTIME-DETAIL",
  );
  await page.getByRole("button", { name: "Clear history" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "No session events recorded",
  );
  await expect(page.locator("#diagnosticsOverall")).toContainText("Error");

  const exported = await downloadJson(page, "Export diagnostics");
  expect(exported.content).not.toContain("LOCAL-RUNTIME-DETAIL");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Healthy");

  await page.evaluate(() => {
    void Promise.reject(new Error("LOCAL-REJECTION-DETAIL"));
  });
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");
  await page.getByRole("button", { name: "Diagnostics: Error" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "runtime.rejection",
  );
});

test("failed startup migration rewrite is reported as a storage error", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open("batflow", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects")) {
          request.result.createObjectStore("projects");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(
        {
          formatVersion: 1,
          project: {
            id: "project:startup-v1",
            name: "Startup migration",
            files: {
              "AUTOEXEC.BAT": {
                content: "exit",
                encoding: "utf-8",
                lineEnding: "CRLF",
              },
            },
            metadata: {},
          },
        },
        "current",
      );
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.addInitScript(() => {
    const put = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function failVersion2Rewrite(
      value,
      key,
    ) {
      if (key === "current" && value?.formatVersion === 2) {
        throw new DOMException("Forced migration failure", "UnknownError");
      }
      return put.call(this, value, key);
    };
  });

  await page.reload();
  await expect(
    page.getByRole("button", { name: "AUTOEXEC.BAT" }),
  ).toBeVisible();
  await expect(page.locator("#appMessage")).toContainText(
    "Recovered project data from batflow-1.",
  );
  await expect(page.locator("#appMessage")).toContainText(
    "The upgraded project could not be saved",
  );
  await expect(page.locator("#appMessage")).toHaveClass(/error/);
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Error");
  await page.getByRole("button", { name: "Diagnostics: Error" }).click();
  await expect(page.locator("#diagnosticsEvents")).toContainText(
    "storage.migration.failed",
  );
  await expect(page.locator("#diagnosticsSaveState")).toHaveText("Error");
});

test("oversized stored outcomes are cleared without losing the project", async ({
  page,
}) => {
  await page.goto("/");
  await importFiles(page, {
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

test("project naming and file lifecycle preserve explicit identity", async ({
  page,
}) => {
  await page.goto("/");
  await createNewProject(page, "Boot: Disk");
  await importFiles(page, [
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from("[MENU]\r\nMENUITEM=NORMAL,Normal"),
    },
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from("echo original\r\nexit"),
    },
  ]);

  await expect(
    page.locator('[data-file="AUTOEXEC.BAT"] .file-badge'),
  ).toHaveText("ENTRY");
  await page.getByRole("button", { name: /CONFIG\.SYS/ }).click();
  await page.getByRole("button", { name: "Set as entry" }).click();
  await expect(page.locator('[data-file="CONFIG.SYS"] .file-badge')).toHaveText(
    "ENTRY",
  );

  await page.getByRole("button", { name: "Rename" }).click();
  await page.locator("#renameFilePath").fill("LONG FOLDER\\CONFIG.SYS");
  await page.getByRole("button", { name: "Rename file" }).click();
  await expect(page.locator("#renameFileError")).toContainText("8.3");
  await page.locator("#renameFilePath").fill("SYS\\CONFIG.SYS");
  await page.getByRole("button", { name: "Rename file" }).click();
  await expect(
    page
      .locator("[data-file]")
      .filter({ hasText: "SYS\\CONFIG.SYS" })
      .locator(".file-badge"),
  ).toHaveText("ENTRY");
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.reload();
  await expect(page.locator("#statusText")).toContainText("SYS\\CONFIG.SYS");
  const fileDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current BAT" }).click();
  expect((await fileDownloadPromise).suggestedFilename()).toBe("CONFIG.SYS");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.locator('[data-file="AUTOEXEC.BAT"] .file-badge'),
  ).toHaveText("ENTRY");

  await page.locator("#projectName").fill("Renamed: Boot");
  await page.locator("#projectName").press("Enter");
  await expect(page.locator("#appMessage")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator("#projectName")).toHaveValue("Renamed: Boot");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "Renamed_ Boot.batflow",
  );

  await page.locator("#fileInput").setInputFiles({
    name: "Long Name.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("exit"),
  });
  await expect(page.locator("#importPreview")).toContainText(
    "imported unchanged",
  );
  await page.locator("#confirmImport").click();
  await expect(page.locator('[data-file="Long Name.BAT"]')).toBeVisible();
  await expect(
    page.locator('[data-file="Long Name.BAT"] .file-warning'),
  ).toBeVisible();
});

test("import preflight handles folder roots, unsupported files, and collisions", async ({
  page,
}, testInfo) => {
  const folder = testInfo.outputPath("BOOTDISK");
  await mkdir(join(folder, "DOS"), { recursive: true });
  await mkdir(join(folder, "Long Folder"), { recursive: true });
  await writeFile(join(folder, "AUTOEXEC.BAT"), "echo folder\r\nexit");
  await writeFile(join(folder, "DOS", "SETUP.BAT"), "exit");
  await writeFile(join(folder, "Long Folder", "Long Name.BAT"), "exit");
  await writeFile(join(folder, "README.PDF"), "unsupported");

  await page.goto("/");
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#folderInput").setInputFiles(folder);
  await expect(page.locator("#confirmImport")).toBeDisabled();
  await page
    .getByLabel("Keep selected folder as the top-level directory")
    .check();
  await expect(page.locator("#importSummary")).toContainText(
    "1 unsupported file",
  );
  await expect(page.locator("#importPreview")).toContainText(
    "BOOTDISK/AUTOEXEC.BAT",
  );
  await page.locator("#confirmImport").click();
  await expect(
    page.locator('[data-file="BOOTDISK/AUTOEXEC.BAT"]'),
  ).toBeVisible();

  await createNewProject(page, "Root-stripped");
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#folderInput").setInputFiles(folder);
  await page.getByLabel("Use folder contents as project root").check();
  await page.locator("#confirmImport").click();
  await expect(page.locator('[data-file="AUTOEXEC.BAT"]')).toBeVisible();
  await expect(page.locator('[data-file="DOS/SETUP.BAT"]')).toBeVisible();
  await expect(
    page.locator('[data-file="Long Folder/Long Name.BAT"]'),
  ).toBeVisible();

  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#folderInput").setInputFiles(folder);
  await page.getByLabel("Use folder contents as project root").check();
  await page
    .getByLabel("Collision action for AUTOEXEC.BAT")
    .selectOption("skip");
  await page
    .getByLabel("Collision action for DOS/SETUP.BAT")
    .selectOption("skip");
  await page
    .getByLabel("Collision action for Long Folder/Long Name.BAT")
    .selectOption("keep");
  await expect(
    page.getByLabel("Keep-both destination for Long Folder/Long Name.BAT"),
  ).toHaveValue("Long Folder/LONGNA~1.BAT");
  await expect(page.locator("#confirmImport")).toBeEnabled();
  await page.locator("#confirmImport").click();
  await expect(
    page.locator('[data-file="Long Folder/LONGNA~1.BAT"]'),
  ).toBeVisible();

  await page.locator("#fileInput").setInputFiles({
    name: "autoexec.bat",
    mimeType: "text/plain",
    buffer: Buffer.from("echo collision\r\nexit"),
  });
  await expect(page.locator("[data-import-action]")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator("#sourceView")).toHaveValue(/echo folder/);

  await page.locator("#fileInput").setInputFiles({
    name: "autoexec.bat",
    mimeType: "text/plain",
    buffer: Buffer.from("echo collision\r\nexit"),
  });
  await page.locator("[data-import-action]").selectOption("keep");
  await expect(page.locator("[data-keep-path]")).toHaveValue("AUTOEX~1.BAT");
  await page.locator("#confirmImport").click();
  await expect(page.locator('[data-file="AUTOEX~1.BAT"]')).toBeVisible();

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo replacement\r\nexit"),
  });
  await page.locator("[data-import-action]").selectOption("skip");
  await page.locator("#confirmImport").click();
  await page.getByRole("button", { name: /AUTOEXEC\.BAT/ }).click();
  await expect(page.locator("#sourceView")).toHaveValue(/echo folder/);

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo replacement\r\nexit"),
  });
  await page.locator("[data-import-action]").selectOption("replace");
  await page.locator("#confirmImport").click();
  await expect(page.locator("#sourceView")).toHaveValue(/echo replacement/);
  await expect(
    page.locator('[data-file="AUTOEXEC.BAT"] .file-badge'),
  ).toHaveText("ENTRY");
});
