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
  await page.locator("#openDiagnostics").click();
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
    "0.5.4-dev.36",
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
  await page.reload();
  await expect(page.getByRole("button", { name: "OFFLINE.BAT" })).toBeVisible();
  await expect(page.locator("#offlineStatus")).toBeVisible();
  await page.getByRole("tab", { name: "Source" }).click();
  await page.locator("#sourceView").fill("echo edited offline\r\nexit");
  await expect(page.locator("#appMessage")).toHaveText("Saved");

  await page.evaluate(() => globalThis.dispatchEvent(new Event("online")));
  await page.waitForTimeout(100);
  await expect(page.locator("#offlineStatus")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBe("1");

  await context.clearCookies();
  await expect(page.locator("#offlineStatus")).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBeNull();
  await page.reload();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator("#sourceView")).toHaveValue(
    "echo edited offline\nexit",
  );
});

test("repairs an evicted active shell before the next offline reload", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");
  await page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    const active = names.find((name) =>
      name.endsWith(":revision:0.5.4-dev.36"),
    );
    if (!active) throw new Error("Active shell cache is missing");
    const cache = await globalThis.caches.open(active);
    const app = (await cache.keys()).find((request) =>
      request.url.includes("/app.js?v=0.5.4-dev.36"),
    );
    if (!app) throw new Error("Cached app entry is missing");
    await cache.delete(app);
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const names = await globalThis.caches.keys();
      const active = names.find((name) =>
        name.endsWith(":revision:0.5.4-dev.36"),
      );
      if (!active) return 0;
      return (await (await globalThis.caches.open(active)).keys()).length;
    }),
  ).toBe(11);

  await page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("batflow-shell-scope:"))
        .map((name) => globalThis.caches.delete(name)),
    );
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const names = await globalThis.caches.keys();
      const active = names.find((name) =>
        name.endsWith(":revision:0.5.4-dev.36"),
      );
      if (!active) return 0;
      return (await (await globalThis.caches.open(active)).keys()).length;
    }),
  ).toBe(11);

  await context.addCookies([
    {
      name: "batflow-test-offline",
      value: "1",
      url: "http://127.0.0.1:41740",
    },
  ]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");
  await context.clearCookies();
});

test("an obsolete active-worker status cannot restore stale offline state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    let delayedStatus = null;
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (message.type !== "BATFLOW_STATUS_REQUEST") return;
        delayedStatus = () => {
          const event = new Event("message");
          Object.defineProperties(event, {
            data: {
              value: {
                type: "BATFLOW_STATUS",
                requestId: message.requestId,
                cacheReady: true,
                offline: true,
                shellRevision: "0.5.4-test-stale",
              },
            },
            source: { value: active },
          });
          container.dispatchEvent(event);
        };
      },
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = null;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__deliverDelayedActiveStatus = () => delayedStatus?.();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    globalThis.dispatchEvent(new Event("online"));
    globalThis.__deliverDelayedActiveStatus();
  });
  await expect(page.locator("#offlineStatus")).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBeNull();
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Attention");
  await page.locator("#openDiagnostics").click();
  await expect(page.locator("#diagnosticsVersions")).not.toContainText(
    "0.5.4-test-stale",
  );
});

test("status detects an incomplete shell and update failures confirm origin reachability", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const container = new EventTarget();
    const registration = new EventTarget();
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (message.type !== "BATFLOW_STATUS_REQUEST") return;
        const event = new Event("message");
        Object.defineProperties(event, {
          data: {
            value: {
              type: "BATFLOW_STATUS",
              requestId: message.requestId,
              cacheReady: globalThis.__batflowTestCacheReady,
              offline: false,
              shellRevision: "0.5.4-test-status",
            },
          },
          source: { value: active },
        });
        if (globalThis.__batflowHoldWorkerStatus) {
          globalThis.__batflowWorkerStatuses.push(event);
        } else {
          globalThis.setTimeout(() => container.dispatchEvent(event), 0);
        }
      },
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = null;
    registration.update = async () => {
      throw new TypeError("Forced update fetch failure");
    };
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowTestCacheReady = true;
    globalThis.__batflowHoldWorkerStatus = true;
    globalThis.__batflowWorkerStatuses = [];
    globalThis.__batflowTestOriginFailure = false;
    globalThis.__batflowHoldOriginProbes = false;
    globalThis.__batflowOriginProbes = [];
    globalThis.__refreshBatflowWorkerStatus = () =>
      container.dispatchEvent(new Event("controllerchange"));
    globalThis.__releaseBatflowWorkerStatus = () => {
      globalThis.__batflowHoldWorkerStatus = false;
      for (const event of globalThis.__batflowWorkerStatuses.splice(0)) {
        container.dispatchEvent(event);
      }
    };
    globalThis.__settleBatflowOriginProbe = (index, reachable) => {
      const probe = globalThis.__batflowOriginProbes[index];
      if (reachable) {
        probe.resolve(new Response("", { status: 200 }));
      } else {
        probe.reject(new TypeError("Forced deferred origin failure"));
      }
    };
    globalThis.fetch = (input, options) => {
      const url = typeof input === "string" ? input : input.url;
      if (
        globalThis.__batflowHoldOriginProbes &&
        String(url).includes("connectivity=")
      ) {
        return new Promise((resolve, reject) => {
          globalThis.__batflowOriginProbes.push({ reject, resolve });
        });
      }
      if (
        globalThis.__batflowTestOriginFailure &&
        String(url).includes("connectivity=")
      ) {
        return Promise.reject(new TypeError("Forced origin failure"));
      }
      return nativeFetch(input, options);
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(page.locator("#diagnosticsStorageState")).toHaveText("Healthy");
  await expect(page.locator("#diagnosticsBadge")).toHaveText("Attention");
  await page.locator("#openDiagnostics").click();
  await expect(page.locator("#diagnosticsOverall")).toContainText(
    "cache: Verifying the offline shell.",
  );
  await page.locator("#closeDiagnostics").click();
  await page.evaluate(() => globalThis.__releaseBatflowWorkerStatus());
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");

  await page.evaluate(() => {
    globalThis.__batflowTestCacheReady = false;
    globalThis.__refreshBatflowWorkerStatus();
  });
  await expect(page.locator("#diagnosticsCacheState")).toHaveText("Failed");

  await page.evaluate(() => {
    globalThis.__batflowTestCacheReady = true;
    globalThis.__refreshBatflowWorkerStatus();
  });
  await expect(page.locator("#diagnosticsCacheState")).toContainText("Ready");

  await page.evaluate(() => {
    globalThis.__batflowTestOriginFailure = true;
    globalThis.dispatchEvent(new Event("online"));
  });
  await expect(page.locator("#offlineStatus")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBe("1");

  await page.evaluate(() => {
    globalThis.__batflowTestOriginFailure = false;
  });
  await expect(page.locator("#offlineStatus")).toBeHidden();

  await page.evaluate(() => {
    globalThis.__batflowHoldOriginProbes = true;
    globalThis.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowOriginProbes.length))
    .toBe(1);
  await page.evaluate(() => {
    globalThis.dispatchEvent(new Event("offline"));
    globalThis.__settleBatflowOriginProbe(0, true);
  });
  await page.waitForTimeout(100);
  await expect(page.locator("#offlineStatus")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBe("1");

  await page.evaluate(() =>
    sessionStorage.removeItem("batflow:connectivity:offline:v1"),
  );
  await page.reload();
  await page.evaluate(() => {
    globalThis.__batflowHoldOriginProbes = true;
    globalThis.dispatchEvent(new Event("online"));
    globalThis.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowOriginProbes.length))
    .toBe(2);
  await page.evaluate(() => {
    globalThis.__settleBatflowOriginProbe(1, true);
    globalThis.__settleBatflowOriginProbe(0, false);
  });
  await page.waitForTimeout(100);
  await expect(page.locator("#offlineStatus")).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBeNull();
});

test("a controlled reload keeps the active entrypoint until update activation", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await waitForOfflineShell(page);
  await context.addCookies([
    {
      name: "batflow-test-new-entry",
      value: "1",
      url: "http://127.0.0.1:41740",
    },
  ]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "UNACTIVATED TEST ENTRYPOINT",
  );
});

test("the complete offline shell is scope-relative under a deployment subpath", async ({
  page,
}) => {
  await page.goto("/batflow/");
  await waitForOfflineShell(page);
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  const workerUrl = await page.evaluate(
    () => globalThis.navigator.serviceWorker.controller.scriptURL,
  );
  expect(workerUrl).toContain("/batflow/service-worker.js");
  expect(new URL(workerUrl).search).toBe("");
});

test("an identical waiting registration canonicalizes without another click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision: "0.5.4-dev.36",
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=0.5.4-test-old",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId);
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waiting, message.requestId);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowDuplicateActivationCount += 1;
        registration.active = waiting;
        registration.waiting = null;
        container.controller = waiting;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowDuplicateActivationCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.__batflowDuplicateActivationCount),
    )
    .toBe(1);
  await expect(page.getByRole("button", { name: "Update ready" })).toBeHidden();
});

test("failed identical-registration activation keeps the update visible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision: "0.5.4-test-same",
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId);
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waiting, message.requestId);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowDuplicateThrowCount += 1;
        throw new DOMException("Worker became redundant", "InvalidStateError");
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowDuplicateThrowCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
  expect(
    await page.evaluate(() => globalThis.__batflowDuplicateThrowCount),
  ).toBe(1);
});

test("a legacy active worker still supplies diagnostics while an update waits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, shellRevision, requestId) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            ...(requestId === undefined ? {} : { requestId }),
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=legacy",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, "0.5.4-test-legacy-active");
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waiting, "0.5.4-test-new-waiting", message.requestId);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowLegacyUnexpectedActivation += 1;
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowLegacyUnexpectedActivation = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Diagnostics: Healthy" }).click();
  await expect(page.locator("#diagnosticsVersions")).toContainText(
    "0.5.4-test-legacy-active",
  );
  expect(
    await page.evaluate(() => globalThis.__batflowLegacyUnexpectedActivation),
  ).toBe(0);
});

test("a click racing identical-registration reconciliation does not reactivate", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const pendingStatus = new Map();
    const sendStatus = (source, requestId) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision: "0.5.4-dev.36",
          },
        },
        source: { value: source },
      });
      container.dispatchEvent(event);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          if (String(message.requestId).endsWith(":active")) {
            pendingStatus.set("active", () =>
              sendStatus(active, message.requestId),
            );
          } else {
            sendStatus(active, message.requestId);
          }
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        if (container.controller === waiting) {
          sendStatus(waiting, message.requestId);
        } else {
          pendingStatus.set("waiting", () =>
            sendStatus(waiting, message.requestId),
          );
        }
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowRaceActivationCount += 1;
        if (container.controller !== waiting) {
          registration.active = waiting;
          registration.waiting = null;
          container.controller = waiting;
          container.dispatchEvent(new Event("controllerchange"));
        }
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowRaceActivationCount = 0;
    globalThis.__releaseDuplicateStatus = () => {
      pendingStatus.get("active")?.();
      pendingStatus.get("waiting")?.();
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await page.evaluate(() => {
    globalThis.document.querySelector("#applyUpdate").click();
    globalThis.__releaseDuplicateStatus();
  });
  await expect(page.locator("#appMessage")).toHaveText("Saved · update active");
  expect(
    await page.evaluate(() => globalThis.__batflowRaceActivationCount),
  ).toBe(1);
  await expect(page.getByRole("button", { name: "Update ready" })).toBeHidden();
});

test("a selected update activated by another tab reloads after saving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const complete =
      sessionStorage.getItem("batflow:test-other-tab-update") === "complete";
    const container = new EventTarget();
    const registration = new EventTarget();
    const pendingStatus = new Map();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      container.dispatchEvent(event);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          if (!complete && String(message.requestId).endsWith(":active")) {
            pendingStatus.set("active", () =>
              sendStatus(active, message.requestId, "0.5.4-test-new"),
            );
          } else {
            sendStatus(active, message.requestId, "0.5.4-test-new");
          }
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        if (!complete && String(message.requestId).endsWith(":waiting")) {
          pendingStatus.set("waiting", () =>
            sendStatus(waiting, message.requestId, "0.5.4-test-new"),
          );
        } else {
          sendStatus(waiting, message.requestId, "0.5.4-test-new");
        }
      }
    };
    registration.active = complete ? waiting : active;
    registration.installing = null;
    registration.waiting = complete ? null : waiting;
    registration.update = async () => {};
    container.controller = registration.active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__releaseNewerDuplicateStatus = () => {
      pendingStatus.get("active")?.();
      pendingStatus.get("waiting")?.();
    };
    globalThis.__activateBatflowUpdateFromOtherTab = () => {
      sessionStorage.setItem("batflow:test-other-tab-update", "complete");
      registration.active = waiting;
      registration.waiting = null;
      container.controller = waiting;
      container.dispatchEvent(new Event("controllerchange"));
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await importFiles(page, {
    name: "OTHERTAB.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo retained\r\nexit"),
  });
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => {
      globalThis.document.querySelector("#applyUpdate").click();
      globalThis.__releaseNewerDuplicateStatus();
      globalThis.__activateBatflowUpdateFromOtherTab();
    }),
  ]);

  await expect(page.locator('[data-file="OTHERTAB.BAT"]')).toBeVisible();
  await expect(updateButton).toBeHidden();
});

test("a directly verified matching update avoids a redundant reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const complete =
      sessionStorage.getItem("batflow:test-direct-match") === "complete";
    sessionStorage.setItem(
      "batflow:test-direct-match-loads",
      String(
        Number(sessionStorage.getItem("batflow:test-direct-match-loads")) + 1,
      ),
    );
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      container.dispatchEvent(event);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (
          message.type === "BATFLOW_STATUS_REQUEST" &&
          !String(message.requestId).endsWith(":active")
        ) {
          sendStatus(active, message.requestId, "0.5.4-test-old");
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type !== "BATFLOW_STATUS_REQUEST") return;
      if (String(message.requestId).startsWith("revision-")) {
        globalThis.__batflowDirectRevisionRequests += 1;
        sendStatus(waiting, message.requestId, "0.5.4-dev.36");
        sessionStorage.setItem("batflow:test-direct-match", "complete");
        registration.active = waiting;
        registration.waiting = null;
        container.controller = waiting;
        container.dispatchEvent(new Event("controllerchange"));
      } else if (complete || !String(message.requestId).endsWith(":waiting")) {
        sendStatus(waiting, message.requestId, "0.5.4-dev.36");
      }
    };
    registration.active = complete ? waiting : active;
    registration.installing = null;
    registration.waiting = complete ? null : waiting;
    registration.update = async () => {};
    container.controller = registration.active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowDirectRevisionRequests = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect(page.locator("#appMessage")).toHaveText("Saved · update active");
  expect(
    await page.evaluate(() => globalThis.__batflowDirectRevisionRequests),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-direct-match-loads"),
    ),
  ).toBe("1");
  await expect(updateButton).toBeHidden();
});

test("a stale waiting-worker status cannot activate its newer replacement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (
      source,
      requestId,
      shellRevision,
      delay,
      offline = false,
    ) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), delay);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=0.5.4-test-old",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId, "0.5.4-test-same", 0);
        }
      },
    };
    const waitingA = new EventTarget();
    waitingA.state = "installed";
    waitingA.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=0.5.4-test-a";
    waitingA.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waitingA, message.requestId, "0.5.4-test-same", 100, true);
      }
    };
    const waitingB = new EventTarget();
    waitingB.state = "installing";
    waitingB.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waitingB.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waitingB, message.requestId, "0.5.4-test-new", 0);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowReplacementActivationCount += 1;
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waitingA;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => {
      globalThis.setTimeout(() => {
        registration.installing = waitingB;
        registration.dispatchEvent(new Event("updatefound"));
        globalThis.setTimeout(() => {
          waitingB.state = "installed";
          registration.installing = null;
          registration.waiting = waitingB;
          waitingB.dispatchEvent(new Event("statechange"));
        }, 0);
      }, 10);
      return registration;
    };
    globalThis.__batflowReplacementActivationCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => globalThis.__batflowReplacementActivationCount),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await expect(page.locator("#offlineStatus")).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:connectivity:offline:v1"),
    ),
  ).toBeNull();
});

test("an available update reloads only after the current project saves", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const phase = sessionStorage.getItem("batflow:test-update");
    const container = new EventTarget();
    const registration = new EventTarget();
    const revisionedActive = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=0.5.4-test-old",
      postMessage() {},
    };
    const revisionedWaiting = new EventTarget();
    revisionedWaiting.state = "installed";
    revisionedWaiting.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=0.5.4-test-old";
    const stableWorker = new EventTarget();
    stableWorker.state = "installed";
    stableWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    const sendStatus = (source, requestId) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision: "0.5.4-test-approved",
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const activate = (worker, nextPhase) => {
      globalThis.__batflowActivationCount += 1;
      const total =
        Number(sessionStorage.getItem("batflow:test-activation-total")) + 1;
      sessionStorage.setItem("batflow:test-activation-total", String(total));
      sessionStorage.setItem("batflow:test-update", nextPhase);
      registration.active = worker;
      registration.waiting = null;
      container.controller = worker;
      globalThis.setTimeout(
        () => container.dispatchEvent(new Event("controllerchange")),
        0,
      );
    };
    revisionedWaiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(revisionedWaiting, message.requestId);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        activate(revisionedWaiting, "revisioned-active");
      }
    };
    stableWorker.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(stableWorker, message.requestId);
      } else if (message.type === "BATFLOW_ACTIVATE") {
        activate(stableWorker, "complete");
      }
    };

    registration.active =
      phase === "complete" ? stableWorker : revisionedActive;
    registration.installing = null;
    registration.waiting = phase === "complete" ? null : revisionedWaiting;
    registration.update = async () => {};
    container.controller = registration.active;
    container.ready = Promise.resolve(registration);
    container.register = async (scriptURL) => {
      if (
        scriptURL === "./service-worker.js" &&
        sessionStorage.getItem("batflow:test-update") === "revisioned-active"
      ) {
        registration.waiting = stableWorker;
      }
      return registration;
    };
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
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-activation-total"),
    ),
  ).toBe("2");
});

test("a synchronous activation failure restores the update action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId, "0.5.4-test-old");
        }
      },
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waiting, message.requestId, "0.5.4-test-new");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowThrowingActivationCount += 1;
        throw new DOMException("Worker became redundant", "InvalidStateError");
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowThrowingActivationCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
  expect(
    await page.evaluate(() => globalThis.__batflowThrowingActivationCount),
  ).toBe(1);
});

test("an unrelated controller change cannot complete an approved update", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId, "0.5.4-test-old");
        }
      },
    };
    const unrelated = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage() {},
    };
    const waiting = new EventTarget();
    waiting.state = "installed";
    waiting.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    waiting.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(waiting, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowApprovedActivationCount += 1;
        registration.active = unrelated;
        container.controller = unrelated;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    registration.active = active;
    registration.installing = null;
    registration.waiting = waiting;
    registration.update = async () => {};
    container.controller = active;
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    globalThis.__batflowApprovedActivationCount = 0;
    sessionStorage.setItem(
      "batflow:test-unrelated-controller-loads",
      String(
        Number(
          sessionStorage.getItem("batflow:test-unrelated-controller-loads"),
        ) + 1,
      ),
    );
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect(page.locator("#appMessage")).toContainText(
    "changed unexpectedly",
  );
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => globalThis.__batflowApprovedActivationCount),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-unrelated-controller-loads"),
    ),
  ).toBe("1");
});

test("a late stable activation remains recoverable after its timeout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeClearTimeout = globalThis.clearTimeout;
    const controlledTimeouts = new Map();
    let controlledTimeoutCounter = 0;
    globalThis.setTimeout = (callback, delay, ...arguments_) => {
      if (delay !== 10000) {
        return nativeSetTimeout(callback, delay, ...arguments_);
      }
      controlledTimeoutCounter += 1;
      const handle = 900000 + controlledTimeoutCounter;
      controlledTimeouts.set(handle, () => callback(...arguments_));
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      if (!controlledTimeouts.delete(handle)) {
        nativeClearTimeout(handle);
      }
    };
    globalThis.__fireBatflowActivationTimeout = () => {
      const callbacks = [...controlledTimeouts.values()];
      controlledTimeouts.clear();
      callbacks.forEach((callback) => callback());
    };
    sessionStorage.setItem(
      "batflow:test-late-stable-loads",
      String(
        Number(sessionStorage.getItem("batflow:test-late-stable-loads")) + 1,
      ),
    );
    const complete =
      sessionStorage.getItem("batflow:test-late-stable-activation") ===
      "complete";
    const delayFirstActivation =
      sessionStorage.getItem("batflow:test-delay-first-activation") === "1";
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      nativeSetTimeout(() => container.dispatchEvent(event), 0);
    };
    const oldWorker = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage() {},
    };
    const approvedWorker = new EventTarget();
    approvedWorker.state = "installed";
    approvedWorker.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=approved";
    const stableWorker = new EventTarget();
    stableWorker.state = "installed";
    stableWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    const newerWorker = new EventTarget();
    newerWorker.state = "installed";
    newerWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    approvedWorker.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(approvedWorker, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        const activateApprovedWorker = () => {
          registration.active = approvedWorker;
          if (registration.waiting === approvedWorker) {
            registration.waiting = null;
          }
          container.controller = approvedWorker;
          container.dispatchEvent(new Event("controllerchange"));
        };
        if (delayFirstActivation) {
          globalThis.__releaseLateRevisionedActivation = activateApprovedWorker;
        } else {
          nativeSetTimeout(activateApprovedWorker, 0);
        }
      }
    };
    newerWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-")
      ) {
        globalThis.__releaseNewerRevisionAfterTimeout = () =>
          sendStatus(newerWorker, message.requestId, "0.5.4-test-newer");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__releaseNewerActivationAfterTimeout = () => {
          sessionStorage.setItem(
            "batflow:test-late-stable-activation",
            "complete",
          );
          registration.active = newerWorker;
          if (registration.waiting === newerWorker) {
            registration.waiting = null;
          }
          container.controller = newerWorker;
          container.dispatchEvent(new Event("controllerchange"));
        };
      }
    };
    stableWorker.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        globalThis.__batflowStableRevisionRequests += 1;
        if (globalThis.__batflowStableRevisionRequests === 1) {
          sendStatus(stableWorker, message.requestId, "0.5.4-test-approved");
        } else {
          globalThis.__releaseStableRetryRevision = () =>
            sendStatus(stableWorker, message.requestId, "0.5.4-test-approved");
        }
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowStableActivationPosts += 1;
        globalThis.__releaseLateStableActivation = (replace = false) => {
          if (!replace) {
            sessionStorage.setItem(
              "batflow:test-late-stable-activation",
              "complete",
            );
          }
          registration.active = stableWorker;
          registration.waiting = null;
          container.controller = stableWorker;
          container.dispatchEvent(new Event("controllerchange"));
          if (replace) {
            const replacement = {
              scriptURL: "http://127.0.0.1:41740/service-worker.js",
              postMessage() {},
            };
            registration.active = replacement;
            registration.waiting = stableWorker;
            container.controller = replacement;
            container.dispatchEvent(new Event("controllerchange"));
          }
        };
      }
    };
    registration.active = complete ? stableWorker : oldWorker;
    registration.installing = null;
    registration.waiting = complete ? null : approvedWorker;
    registration.update = async () => {};
    container.controller = registration.active;
    container.ready = Promise.resolve(registration);
    container.register = async () => {
      if (container.controller === approvedWorker) {
        registration.waiting = stableWorker;
      }
      return registration;
    };
    globalThis.__batflowStableRevisionRequests = 0;
    globalThis.__batflowStableActivationPosts = 0;
    globalThis.__replaceWaitingAfterTimeout = () => {
      registration.waiting = newerWorker;
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowStableActivationPosts))
    .toBe(1);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__releaseStableRetryRevision === "function",
      ),
    )
    .toBe(true);
  await expect(updateButton).toBeDisabled();

  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => globalThis.__releaseLateStableActivation()),
  ]);
  await expect(updateButton).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-late-stable-activation"),
    ),
  ).toBe("complete");

  await page.evaluate(() =>
    sessionStorage.removeItem("batflow:test-late-stable-activation"),
  );
  await page.reload();
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowStableActivationPosts))
    .toBe(1);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  const loadCountBeforeReplacement = await page.evaluate(() =>
    sessionStorage.getItem("batflow:test-late-stable-loads"),
  );
  await page.evaluate(() => globalThis.__releaseLateStableActivation(true));
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-late-stable-loads"),
    ),
  ).toBe(loadCountBeforeReplacement);

  await page.evaluate(() =>
    sessionStorage.setItem("batflow:test-delay-first-activation", "1"),
  );
  await page.reload();
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseLateRevisionedActivation === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await expect(updateButton).toBeVisible();
  await page.evaluate(() => globalThis.__releaseLateRevisionedActivation());
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowStableActivationPosts))
    .toBe(1);
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => globalThis.__releaseLateStableActivation()),
  ]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("batflow:test-late-stable-activation"),
    ),
  ).toBe("complete");

  await page.evaluate(() =>
    sessionStorage.removeItem("batflow:test-late-stable-activation"),
  );
  await page.reload();
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseLateRevisionedActivation === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await page.evaluate(() => globalThis.__replaceWaitingAfterTimeout());
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseNewerRevisionAfterTimeout === "function",
      ),
    )
    .toBe(true);
  await expect(updateButton).toBeDisabled();
  await page.evaluate(() => globalThis.__releaseNewerRevisionAfterTimeout());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseNewerActivationAfterTimeout === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__releaseLateRevisionedActivation());
  await expect(updateButton).toBeDisabled();
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => globalThis.__releaseNewerActivationAfterTimeout()),
  ]);

  await page.evaluate(() =>
    sessionStorage.removeItem("batflow:test-late-stable-activation"),
  );
  await page.reload();
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseLateRevisionedActivation === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await page.evaluate(() => globalThis.__replaceWaitingAfterTimeout());
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseNewerRevisionAfterTimeout === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__releaseNewerRevisionAfterTimeout());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof globalThis.__releaseNewerActivationAfterTimeout === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__fireBatflowActivationTimeout());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await expect(updateButton).toBeVisible();
  await page.evaluate(() => globalThis.__releaseLateRevisionedActivation());
  await expect(updateButton).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => globalThis.__releaseNewerActivationAfterTimeout()),
  ]);
});

test("a stale migration failure cannot cancel a newer update attempt", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const oldWorker = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage() {},
    };
    const approvedWorker = new EventTarget();
    approvedWorker.state = "installed";
    approvedWorker.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=approved";
    const stableWorker = new EventTarget();
    stableWorker.state = "installed";
    stableWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    const unrelatedWorker = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js",
      postMessage() {},
    };
    const newerWorker = new EventTarget();
    newerWorker.state = "installed";
    newerWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    approvedWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-")
      ) {
        sendStatus(approvedWorker, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        registration.active = approvedWorker;
        registration.waiting = null;
        container.controller = approvedWorker;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    stableWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-")
      ) {
        globalThis.__releaseStaleMigration = () =>
          sendStatus(stableWorker, message.requestId, "0.5.4-test-approved");
      }
    };
    newerWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-")
      ) {
        globalThis.__releaseNewerUpdate = () =>
          sendStatus(newerWorker, message.requestId, "0.5.4-test-newer");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        throw new DOMException("Forced retry stop", "InvalidStateError");
      }
    };
    registration.active = oldWorker;
    registration.installing = null;
    registration.waiting = approvedWorker;
    registration.update = async () => {};
    container.controller = oldWorker;
    container.ready = Promise.resolve(registration);
    container.register = async () => {
      if (container.controller === approvedWorker) {
        registration.waiting = stableWorker;
      }
      return registration;
    };
    globalThis.__replaceControllerDuringMigration = () => {
      registration.active = unrelatedWorker;
      registration.waiting = newerWorker;
      container.controller = unrelatedWorker;
      container.dispatchEvent(new Event("controllerchange"));
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  const updateButton = page.getByRole("button", { name: "Update ready" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__releaseStaleMigration === "function",
      ),
    )
    .toBe(true);

  await page.evaluate(() => globalThis.__replaceControllerDuringMigration());
  await expect(page.locator("#appMessage")).toContainText(
    "changed unexpectedly",
  );
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__releaseNewerUpdate === "function",
      ),
    )
    .toBe(true);
  await expect(updateButton).toBeDisabled();

  await page.evaluate(() => globalThis.__releaseStaleMigration());
  await page.waitForTimeout(100);
  await expect(updateButton).toBeDisabled();
  await page.evaluate(() => globalThis.__releaseNewerUpdate());
  await expect(page.locator("#appMessage")).toContainText(
    "could not be activated",
  );
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toBeEnabled();
});

test("edits made during update verification are saved before activation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const complete =
      sessionStorage.getItem("batflow:test-late-edit-update") === "complete";
    const container = new EventTarget();
    const registration = new EventTarget();
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    const active = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage(message) {
        if (message.type === "BATFLOW_STATUS_REQUEST") {
          sendStatus(active, message.requestId, "0.5.4-test-old");
        }
      },
    };
    const revisionedWorker = new EventTarget();
    revisionedWorker.state = "installed";
    revisionedWorker.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=approved";
    const stableWorker = new EventTarget();
    stableWorker.state = "installed";
    stableWorker.scriptURL = "http://127.0.0.1:41740/service-worker.js";
    revisionedWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-")
      ) {
        globalThis.__batflowRevisionRequestCount += 1;
        globalThis.__batflowRevisionRequestStage = 1;
        globalThis.__releaseBatflowRevisionRequest = () =>
          sendStatus(
            revisionedWorker,
            message.requestId,
            "0.5.4-test-approved",
          );
      } else if (message.type === "BATFLOW_ACTIVATE") {
        registration.active = revisionedWorker;
        registration.waiting = null;
        container.controller = revisionedWorker;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    stableWorker.postMessage = (message) => {
      if (
        message.type === "BATFLOW_STATUS_REQUEST" &&
        String(message.requestId).startsWith("revision-") &&
        !complete
      ) {
        globalThis.__batflowRevisionRequestStage = 2;
        globalThis.__releaseBatflowStableRevisionRequest = () =>
          sendStatus(stableWorker, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_STATUS_REQUEST" && complete) {
        sendStatus(stableWorker, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        sessionStorage.setItem("batflow:test-late-edit-update", "complete");
        registration.active = stableWorker;
        registration.waiting = null;
        container.controller = stableWorker;
        globalThis.__batflowRevisionRequestStage = 3;
        globalThis.__releaseBatflowControllerChange = () =>
          container.dispatchEvent(new Event("controllerchange"));
      }
    };
    registration.active = complete ? stableWorker : active;
    registration.installing = null;
    registration.waiting = complete ? null : revisionedWorker;
    registration.update = async () => {};
    container.controller = registration.active;
    container.ready = Promise.resolve(registration);
    container.register = async () => {
      if (container.controller === revisionedWorker) {
        registration.waiting = stableWorker;
      }
      return registration;
    };
    globalThis.__batflowRevisionRequestStage = 0;
    globalThis.__batflowRevisionRequestCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await importFiles(page, {
    name: "LATEEDIT.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("echo before\r\nexit"),
  });
  await page.getByRole("tab", { name: "Source" }).click();
  await page.evaluate(() => {
    const button = globalThis.document.querySelector("#applyUpdate");
    button.click();
    button.click();
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowRevisionRequestStage))
    .toBe(1);
  expect(
    await page.evaluate(() => globalThis.__batflowRevisionRequestCount),
  ).toBe(1);
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeDisabled();
  await page
    .locator("#sourceView")
    .fill("echo edited during verification\r\nexit");
  await page.evaluate(() => globalThis.__releaseBatflowRevisionRequest());
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowRevisionRequestStage))
    .toBe(2);
  await page
    .locator("#sourceView")
    .fill("echo edited during stable migration\r\nexit");
  await page.evaluate(() => globalThis.__releaseBatflowStableRevisionRequest());
  await expect
    .poll(() => page.evaluate(() => globalThis.__batflowRevisionRequestStage))
    .toBe(3);
  await page
    .locator("#sourceView")
    .fill("echo edited after activation request\r\nexit");

  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => globalThis.__releaseBatflowControllerChange()),
  ]);
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator("#sourceView")).toHaveValue(
    "echo edited after activation request\nexit",
  );
});

test("migration refuses a stable waiter with a different revision", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget();
    const revisionedActive = {
      scriptURL: "http://127.0.0.1:41740/service-worker.js?v=old",
      postMessage() {},
    };
    const approvedWorker = new EventTarget();
    approvedWorker.state = "installed";
    approvedWorker.scriptURL =
      "http://127.0.0.1:41740/service-worker.js?v=approved";
    const differentStableWorker = new EventTarget();
    differentStableWorker.state = "installed";
    differentStableWorker.scriptURL =
      "http://127.0.0.1:41740/service-worker.js";
    const sendStatus = (source, requestId, shellRevision) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        data: {
          value: {
            type: "BATFLOW_STATUS",
            requestId,
            cacheReady: true,
            offline: false,
            shellRevision,
          },
        },
        source: { value: source },
      });
      globalThis.setTimeout(() => container.dispatchEvent(event), 0);
    };
    approvedWorker.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(approvedWorker, message.requestId, "0.5.4-test-approved");
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowApprovedActivationCount += 1;
        registration.active = approvedWorker;
        registration.waiting = null;
        container.controller = approvedWorker;
        globalThis.setTimeout(
          () => container.dispatchEvent(new Event("controllerchange")),
          0,
        );
      }
    };
    differentStableWorker.postMessage = (message) => {
      if (message.type === "BATFLOW_STATUS_REQUEST") {
        sendStatus(
          differentStableWorker,
          message.requestId,
          "0.5.4-test-different",
        );
      } else if (message.type === "BATFLOW_ACTIVATE") {
        globalThis.__batflowDifferentActivationCount += 1;
      }
    };
    registration.active = revisionedActive;
    registration.installing = null;
    registration.waiting = approvedWorker;
    registration.update = async () => {};
    container.controller = revisionedActive;
    container.ready = Promise.resolve(registration);
    container.register = async () => {
      if (container.controller === approvedWorker) {
        registration.waiting = differentStableWorker;
      }
      return registration;
    };
    globalThis.__batflowApprovedActivationCount = 0;
    globalThis.__batflowDifferentActivationCount = 0;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update ready" }).click();
  await expect(page.locator("#appMessage")).toContainText(
    "stable browser registration could not be completed",
  );
  expect(
    await page.evaluate(() => globalThis.__batflowApprovedActivationCount),
  ).toBe(1);
  expect(
    await page.evaluate(() => globalThis.__batflowDifferentActivationCount),
  ).toBe(0);
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
    offlineShell: "0.5.4-dev.36",
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
