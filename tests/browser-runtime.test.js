import assert from "node:assert/strict";
import test from "node:test";

import {
  PERSISTENCE_REQUESTED_KEY,
  SHELL_REVISION,
  ensureStoragePersistence,
} from "../public/lib/browser-runtime.js";

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

test("declares the managed offline shell revision", () => {
  assert.equal(SHELL_REVISION, "0.5.4-dev.29");
});

test("reports persistent storage without requesting it again", async () => {
  let requests = 0;
  const result = await ensureStoragePersistence({
    storageManager: {
      persisted: async () => true,
      persist: async () => {
        requests += 1;
        return true;
      },
    },
    markerStorages: [memoryStorage()],
  });
  assert.equal(result.status, "persistent");
  assert.equal(result.attempted, false);
  assert.equal(requests, 0);
});

test("records the attempt before requesting persistent storage", async () => {
  const marker = memoryStorage();
  const result = await ensureStoragePersistence({
    storageManager: {
      persisted: async () => false,
      persist: async () => {
        assert.equal(marker.getItem(PERSISTENCE_REQUESTED_KEY), "1");
        return true;
      },
    },
    markerStorages: [marker],
  });
  assert.equal(result.status, "persistent");
  assert.equal(result.attempted, true);
});

test("a denied persistence request remains best effort and is not repeated", async () => {
  const marker = memoryStorage();
  let requests = 0;
  const storageManager = {
    persisted: async () => false,
    persist: async () => {
      requests += 1;
      return false;
    },
  };
  const first = await ensureStoragePersistence({
    storageManager,
    markerStorages: [marker],
  });
  const second = await ensureStoragePersistence({
    storageManager,
    markerStorages: [marker],
  });
  assert.equal(first.status, "best-effort");
  assert.equal(first.attempted, true);
  assert.equal(second.status, "best-effort");
  assert.equal(second.attempted, false);
  assert.equal(requests, 1);
});

test("uses a later marker store when the preferred store is blocked", async () => {
  const fallback = memoryStorage();
  const blocked = {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  const result = await ensureStoragePersistence({
    storageManager: {
      persisted: async () => false,
      persist: async () => false,
    },
    markerStorages: [blocked, fallback],
  });
  assert.equal(result.attempted, true);
  assert.equal(fallback.getItem(PERSISTENCE_REQUESTED_KEY), "1");
});

test("does not request persistence when no marker can be retained", async () => {
  let requests = 0;
  const result = await ensureStoragePersistence({
    storageManager: {
      persisted: async () => false,
      persist: async () => {
        requests += 1;
        return true;
      },
    },
    markerStorages: [],
  });
  assert.equal(result.status, "best-effort");
  assert.equal(result.attempted, false);
  assert.equal(requests, 0);
});

test("unsupported, unreadable, and rejected persistence APIs degrade safely", async () => {
  assert.equal(
    (await ensureStoragePersistence({ storageManager: null })).status,
    "unsupported",
  );
  assert.equal(
    (
      await ensureStoragePersistence({
        storageManager: {
          persisted: async () => {
            throw new Error("read failed");
          },
          persist: async () => true,
        },
        markerStorages: [memoryStorage()],
      })
    ).status,
    "unknown",
  );
  assert.equal(
    (
      await ensureStoragePersistence({
        storageManager: {
          persisted: async () => false,
          persist: async () => {
            throw new Error("request failed");
          },
        },
        markerStorages: [memoryStorage()],
      })
    ).status,
    "best-effort",
  );
});
