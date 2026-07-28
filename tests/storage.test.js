import assert from "node:assert/strict";
import test from "node:test";

import { IDBFactory } from "fake-indexeddb";

import {
  DATABASE_NAME,
  LEGACY_DATABASE_NAMES,
  loadCurrentProject,
  resetStorageConnectionForTests,
  saveCurrentProject,
} from "../public/lib/storage.js";
import { addTextFile, createProject } from "../public/lib/project-format.js";

async function putRaw(factory, databaseName, value) {
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(value, "current");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

test.afterEach(async () => {
  await resetStorageConnectionForTests();
});

test("current projects are stored in the stable database as versioned documents", async () => {
  const indexedDB = new IDBFactory();
  const expected = addTextFile(
    createProject("Stored"),
    "MAIN.BAT",
    "echo saved",
  );
  await saveCurrentProject(expected, { indexedDB });

  const loaded = await loadCurrentProject({ indexedDB });
  assert.equal(loaded.project.name, "Stored");
  assert.equal(loaded.project.files["MAIN.BAT"].content, "echo saved");
  assert.equal(loaded.migratedFrom, null);
  assert.equal(
    (await indexedDB.databases()).some((item) => item.name === DATABASE_NAME),
    true,
  );
});

for (const legacyName of LEGACY_DATABASE_NAMES) {
  test(`legacy ${legacyName} data is copied without deleting its database`, async () => {
    const indexedDB = new IDBFactory();
    await putRaw(indexedDB, legacyName, {
      name: `Legacy ${legacyName}`,
      files: {
        "OLD.BAT": { content: "echo old" },
      },
      metadata: {},
    });

    const loaded = await loadCurrentProject({ indexedDB });
    assert.equal(loaded.migratedFrom, legacyName);
    assert.equal(loaded.project.files["OLD.BAT"].content, "echo old");

    const names = (await indexedDB.databases()).map((item) => item.name);
    assert.ok(names.includes(legacyName));
    assert.ok(names.includes(DATABASE_NAME));
  });
}

test("malformed primary project data is reported instead of discarded", async () => {
  const indexedDB = new IDBFactory();
  await putRaw(indexedDB, DATABASE_NAME, {
    formatVersion: 999,
    project: {},
  });
  await assert.rejects(
    loadCurrentProject({ indexedDB }),
    /Unsupported project format version/,
  );
});
