import assert from "node:assert/strict";
import test from "node:test";

import { createSaveQueue } from "../public/lib/save-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromiseChain() {
  await Promise.resolve();
  await Promise.resolve();
}

test("an older save cannot mark a newer debounced revision as saved", async () => {
  const scheduled = [];
  const saves = [];
  const statuses = [];
  const queue = createSaveQueue({
    save(snapshot) {
      const pending = deferred();
      saves.push({ snapshot, pending });
      return pending.promise;
    },
    onStatus(message) {
      statuses.push(message);
    },
    schedule(callback) {
      scheduled.push(callback);
      return callback;
    },
    cancel(callback) {
      const index = scheduled.indexOf(callback);
      if (index >= 0) scheduled.splice(index, 1);
    },
  });

  queue.queue({ value: "first" });
  const firstPersist = scheduled.shift();
  const firstCompletion = firstPersist();
  await flushPromiseChain();
  assert.equal(saves[0].snapshot.value, "first");

  queue.queue({ value: "latest" });
  assert.equal(statuses.at(-1), "Unsaved changes");
  saves[0].pending.resolve();
  assert.equal((await firstCompletion).status, "superseded");
  assert.equal(statuses.at(-1), "Unsaved changes");

  const latestPersist = scheduled.shift();
  const latestCompletion = latestPersist();
  await flushPromiseChain();
  assert.equal(saves[1].snapshot.value, "latest");
  saves[1].pending.resolve();
  assert.equal((await latestCompletion).status, "saved");
  assert.equal(statuses.at(-1), "Saved");
});

test("a current save failure is reported to its caller and status consumer", async () => {
  const error = new Error("storage unavailable");
  const statuses = [];
  const queue = createSaveQueue({
    save() {
      throw error;
    },
    onStatus(message) {
      statuses.push(message);
    },
  });

  const result = await queue.queue({ value: "project" }, { immediate: true });

  assert.equal(result.status, "failed");
  assert.equal(result.error, error);
  assert.equal(statuses.at(-1), "Save failed: storage unavailable");
});

test("an older save failure cannot overwrite a newer unsaved status", async () => {
  const scheduled = [];
  const firstSave = deferred();
  const statuses = [];
  let saveCount = 0;
  const queue = createSaveQueue({
    save() {
      saveCount += 1;
      return saveCount === 1 ? firstSave.promise : Promise.resolve();
    },
    onStatus(message) {
      statuses.push(message);
    },
    schedule(callback) {
      scheduled.push(callback);
      return callback;
    },
    cancel() {},
  });

  const firstCompletion = queue.queue({ value: "first" }, { immediate: true });
  await flushPromiseChain();
  queue.queue({ value: "latest" });
  firstSave.reject(new Error("stale failure"));

  const firstResult = await firstCompletion;
  assert.equal(firstResult.status, "superseded");
  assert.equal(statuses.at(-1), "Unsaved changes");

  const latestResult = await scheduled.shift()();
  assert.equal(latestResult.status, "saved");
  assert.equal(statuses.at(-1), "Saved");
});
