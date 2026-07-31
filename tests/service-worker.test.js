import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = readFileSync(
  join(root, "public/service-worker.js"),
  "utf8",
);

function createWorker(scopePath, options = {}) {
  const listeners = {};
  const deletedCaches = [];
  const openedCaches = [];
  let fetchCount = 0;
  let globalCacheMatchCount = 0;
  const cache = {
    addAll: async () => {},
    match: async (request) =>
      options.cachedResponses?.get(
        typeof request === "string" ? request : request.url,
      ) || null,
  };
  const context = {
    Request,
    Response,
    Set,
    URL,
    caches: {
      delete: async (name) => {
        deletedCaches.push(name);
        return true;
      },
      keys: async () => options.cacheNames || [],
      match: async () => {
        globalCacheMatchCount += 1;
        return options.foreignCachedResponse || null;
      },
      open: async (name) => {
        openedCaches.push(name);
        return cache;
      },
    },
    clients: { claim: async () => {} },
    encodeURIComponent,
    fetch: async () => {
      fetchCount += 1;
      return new Response("network");
    },
    location: {
      href: `https://example.test${scopePath}service-worker.js?v=test`,
    },
    skipWaiting: async () => {},
  };
  context.addEventListener = (type, listener) => {
    listeners[type] = listener;
  };
  context.globalThis = context;
  vm.runInNewContext(workerSource, context);
  return {
    deletedCaches,
    fetchCount: () => fetchCount,
    globalCacheMatchCount: () => globalCacheMatchCount,
    listeners,
    openedCaches,
  };
}

test("controlled navigation keeps the active worker's cached entrypoint", async () => {
  const indexUrl = "https://example.test/index.html";
  const worker = createWorker("/", {
    cachedResponses: new Map([[indexUrl, new Response("active shell")]]),
  });
  let responsePromise;

  worker.listeners.fetch({
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://example.test/",
    },
    respondWith(value) {
      responsePromise = value;
    },
  });

  const response = await responsePromise;
  assert.equal(await response.text(), "active shell");
  assert.equal(worker.fetchCount(), 0);
  assert.deepEqual(worker.openedCaches, [
    "batflow-shell-scope:%2F:revision:0.5.4-dev.27",
  ]);
});

test("controlled navigation fails closed when its active entrypoint is missing", async () => {
  const worker = createWorker("/");
  let responsePromise;

  worker.listeners.fetch({
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://example.test/",
    },
    respondWith(value) {
      responsePromise = value;
    },
  });

  const response = await responsePromise;
  assert.equal(response.type, "error");
  assert.equal(worker.fetchCount(), 0);
});

test("activation deletes only shell caches owned by its scope", async () => {
  const rootCurrent = "batflow-shell-scope:%2F:revision:0.5.4-dev.27";
  const rootOld = "batflow-shell-scope:%2F:revision:0.5.4-dev.13";
  const nestedOld = "batflow-shell-scope:%2F-preview%2F:revision:0.5.4-dev.13";
  const worker = createWorker("/", {
    cacheNames: [rootCurrent, rootOld, nestedOld, "unrelated-cache"],
  });
  let activation;

  worker.listeners.activate({
    waitUntil(value) {
      activation = value;
    },
  });
  await activation;

  assert.deepEqual(worker.deletedCaches, [rootOld]);
});

test("versioned shell assets fail closed instead of reading another cache or the network", async () => {
  const worker = createWorker("/", {
    foreignCachedResponse: new Response("foreign shell"),
  });
  let responsePromise;

  worker.listeners.fetch({
    request: new Request("https://example.test/app.js?v=0.5.4-dev.27"),
    respondWith(value) {
      responsePromise = value;
    },
  });

  const response = await responsePromise;
  assert.equal(response.type, "error");
  assert.equal(worker.fetchCount(), 0);
  assert.equal(worker.globalCacheMatchCount(), 0);
});

test("versioned shell assets are served from the active worker's own cache", async () => {
  const assetUrl = "https://example.test/app.js?v=0.5.4-dev.27";
  const worker = createWorker("/", {
    cachedResponses: new Map([[assetUrl, new Response("active asset")]]),
  });
  let responsePromise;

  worker.listeners.fetch({
    request: new Request(assetUrl),
    respondWith(value) {
      responsePromise = value;
    },
  });

  const response = await responsePromise;
  assert.equal(await response.text(), "active asset");
  assert.equal(worker.fetchCount(), 0);
});
