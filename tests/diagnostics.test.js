import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTICS_FORMAT_VERSION,
  DIAGNOSTICS_SESSION_KEY,
  createDiagnosticsDocument,
  createDiagnosticsStore,
} from "../public/lib/diagnostics.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function fixedClock() {
  let second = 0;
  return () => new Date(Date.UTC(2026, 6, 28, 12, 0, second++));
}

test("diagnostic history is bounded and restores within the tab session", () => {
  const storage = memoryStorage();
  const first = createDiagnosticsStore({
    storage,
    clock: fixedClock(),
    maxEvents: 2,
  });
  for (const code of [
    "app.started",
    "storage.load.succeeded",
    "runtime.error",
  ]) {
    first.record({
      severity: code === "runtime.error" ? "error" : "info",
      subsystem: "runtime",
      code,
      summary: code,
      detail: `detail:${code}`,
    });
  }
  first.setSubsystem("save", "saved", { successfulAt: true });

  const restored = createDiagnosticsStore({
    storage,
    clock: fixedClock(),
    maxEvents: 2,
  }).getSnapshot();
  assert.deepEqual(
    restored.events.map((event) => event.code),
    ["storage.load.succeeded", "runtime.error"],
  );
  assert.equal(restored.events[1].detail, "detail:runtime.error");
  assert.equal(restored.lastSuccessfulSaveAt, "2026-07-28T12:00:03.000Z");
  assert.equal(restored.subsystems.runtime.status, "healthy");
  assert.equal(restored.subsystems.save.status, "idle");
});

test("active health has deterministic precedence and survives history clearing", () => {
  const store = createDiagnosticsStore({
    storage: memoryStorage(),
    clock: fixedClock(),
  });
  assert.equal(store.getSnapshot().health, "attention");
  store.setSubsystem("storage", "healthy");
  assert.equal(store.getSnapshot().health, "attention");
  store.setSubsystem("cache", "healthy");
  assert.equal(store.getSnapshot().health, "healthy");
  store.setSubsystem("save", "unsaved");
  assert.equal(store.getSnapshot().health, "saving");
  store.setSubsystem("save", "error", { detail: "quota" });
  store.record({
    severity: "error",
    subsystem: "save",
    code: "storage.save.failed",
    summary: "Project changes could not be saved.",
  });
  assert.equal(store.getSnapshot().health, "error");

  const cleared = store.clearHistory();
  assert.equal(cleared.events.length, 0);
  assert.equal(cleared.health, "error");
  assert.equal(cleared.subsystems.save.detail, "quota");

  store.setSubsystem("save", "saved", { successfulAt: true });
  store.setSubsystem("storage", "healthy");
  assert.equal(store.getSnapshot().health, "healthy");
});

test("unavailable session storage falls back to memory with a warning", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  const store = createDiagnosticsStore({ storage, clock: fixedClock() });
  store.record({
    severity: "info",
    subsystem: "runtime",
    code: "app.started",
    summary: "BATFlow started.",
  });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.health, "attention");
  assert.equal(snapshot.subsystems.retention.status, "attention");
  assert.equal(
    snapshot.events.at(-1).code,
    "diagnostics.retention.unavailable",
  );
});

test("malformed session history is rejected without breaking diagnostics", () => {
  const storage = memoryStorage();
  storage.values.set(DIAGNOSTICS_SESSION_KEY, "{not-json");
  const snapshot = createDiagnosticsStore({
    storage,
    clock: fixedClock(),
  }).getSnapshot();
  assert.equal(snapshot.health, "attention");
  assert.equal(snapshot.subsystems.retention.status, "attention");
  assert.equal(snapshot.events[0].code, "diagnostics.retention.unavailable");
});

test("format-1 session diagnostics are ignored instead of migrated", () => {
  const storage = memoryStorage();
  storage.values.set(
    "batflow:diagnostics:v1",
    JSON.stringify({
      formatVersion: 1,
      events: [{ code: "runtime.error", detail: "OLD-PRIVATE-DETAIL" }],
    }),
  );
  const snapshot = createDiagnosticsStore({
    storage,
    clock: fixedClock(),
  }).getSnapshot();
  assert.deepEqual(snapshot.events, []);
  assert.equal(snapshot.subsystems.retention.status, "healthy");
});

test("retained diagnostics are normalized before display and export", () => {
  const storage = memoryStorage();
  const secret = "PRIVATE-RETAINED-VALUE";
  storage.values.set(
    DIAGNOSTICS_SESSION_KEY,
    JSON.stringify({
      formatVersion: DIAGNOSTICS_FORMAT_VERSION,
      lastSuccessfulSaveAt: secret,
      events: [
        {
          id: secret,
          at: "2026-07-28T12:00:00.000Z",
          severity: secret,
          subsystem: secret,
          code: "runtime.error",
          summary: secret,
          detail: `${secret}${"x".repeat(5000)}`,
        },
        {
          id: secret,
          at: secret,
          severity: secret,
          subsystem: secret,
          code: secret,
          summary: secret,
          detail: secret,
        },
      ],
    }),
  );

  const snapshot = createDiagnosticsStore({
    storage,
    clock: fixedClock(),
  }).getSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.deepEqual(
    {
      id: snapshot.events[0].id,
      severity: snapshot.events[0].severity,
      subsystem: snapshot.events[0].subsystem,
      code: snapshot.events[0].code,
      summary: snapshot.events[0].summary,
    },
    {
      id: "diagnostic:1",
      severity: "info",
      subsystem: "runtime",
      code: "runtime.error",
      summary: "An unexpected application error occurred.",
    },
  );
  assert.equal(snapshot.events[0].detail.length, 4096);
  assert.equal(snapshot.lastSuccessfulSaveAt, null);

  snapshot.health = secret;
  snapshot.subsystems.runtime.status = secret;
  const document = createDiagnosticsDocument(snapshot, {
    createdAt: "2026-07-28T12:30:00.000Z",
    productVersion: "0.5.4",
  });
  const exported = JSON.stringify(document);
  assert.equal(document.health.overall, "unknown");
  assert.equal(document.health.subsystems.runtime, "unknown");
  assert.equal(exported.includes(secret), false);
});

test("diagnostics export contains safe structure and excludes raw project data", () => {
  const storage = memoryStorage();
  const store = createDiagnosticsStore({ storage, clock: fixedClock() });
  store.setSubsystem("storage", "error", {
    detail: "SECRET.BAT contains echo PRIVATE-SOURCE",
  });
  store.record({
    severity: "error",
    subsystem: "storage",
    code: "storage.save.failed",
    summary: "SECRET PROJECT could not save SECRET.BAT",
    detail:
      "PRIVATE-SOURCE; note=PRIVATE-NOTE; config=PRIVATE-SIMULATION-VALUE",
  });
  const document = createDiagnosticsDocument(store.getSnapshot(), {
    createdAt: "2026-07-28T12:30:00.000Z",
    productVersion: "0.5.4",
    projectFormatVersion: 2,
    databaseVersion: 1,
    interpreterProfile: "msdos-7.1-command.com",
    userAgent: "Synthetic browser",
    language: "en-US",
    online: true,
    offlineCache: "ready",
    storageDurability: "best-effort",
    shellRevision: "0.5.4-dev.36",
    fileCount: 4,
    validationCount: 2,
  });
  const exported = JSON.stringify(document);

  assert.equal(document.diagnosticsFormatVersion, DIAGNOSTICS_FORMAT_VERSION);
  assert.equal(document.versionDomains.offlineShell, "0.5.4-dev.36");
  assert.equal(document.runtime.offlineCache, "ready");
  assert.equal(document.runtime.storageDurability, "best-effort");
  assert.deepEqual(document.counts, {
    files: 4,
    validations: 2,
    events: 1,
  });
  assert.equal(
    document.events[0].summary,
    "Project changes could not be saved.",
  );
  for (const secret of [
    "SECRET PROJECT",
    "SECRET.BAT",
    "PRIVATE-SOURCE",
    "PRIVATE-NOTE",
    "PRIVATE-SIMULATION-VALUE",
  ]) {
    assert.equal(exported.includes(secret), false, secret);
  }
});
