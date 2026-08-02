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
  const cachedResponses = options.cachedResponses || new Map();
  const networkFetch = async (request) => {
    fetchCount += 1;
    if (options.fetchResponse) return options.fetchResponse(request);
    return new Response("network");
  };
  const cache = {
    addAll: async (requests) => {
      for (const request of requests) {
        const response = await networkFetch(request);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        cachedResponses.set(request.url, response);
      }
    },
    delete: async (request) =>
      cachedResponses.delete(
        typeof request === "string" ? request : request.url,
      ),
    match: async (request) => {
      const response = cachedResponses.get(
        typeof request === "string" ? request : request.url,
      );
      return response
        ? response.clone()
        : options.cacheContainsAll
          ? new Response(
              '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
            )
          : null;
    },
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
    fetch: networkFetch,
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

async function requestStatus(worker, requestId = "test-status") {
  let statusPromise;
  let status;
  worker.listeners.message({
    data: { type: "BATFLOW_STATUS_REQUEST", requestId },
    source: {
      postMessage(message) {
        status = message;
      },
    },
    waitUntil(value) {
      statusPromise = value;
    },
  });
  await statusPromise;
  return status;
}

test("controlled navigation keeps the active worker's cached entrypoint", async () => {
  const indexUrl = "https://example.test/index.html";
  const worker = createWorker("/", {
    cacheContainsAll: true,
    cachedResponses: new Map([
      [
        indexUrl,
        new Response(
          '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
        ),
      ],
    ]),
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
  assert.match(await response.text(), /app\.js\?v=0\.5\.4-dev\.36/);
  assert.equal(worker.fetchCount(), 0);
  assert.deepEqual(worker.openedCaches, [
    "batflow-shell-scope:%2F:revision:0.5.4-dev.36",
  ]);
});

test("controlled navigation fails closed when matching shell recovery is unavailable", async () => {
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
  assert.equal(worker.fetchCount(), 1);
});

test("activation deletes only shell caches owned by its scope", async () => {
  const rootCurrent = "batflow-shell-scope:%2F:revision:0.5.4-dev.36";
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
    request: new Request("https://example.test/app.js?v=0.5.4-dev.36"),
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
  const assetUrl = "https://example.test/app.js?v=0.5.4-dev.36";
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

test("status verifies the complete active shell cache", async () => {
  const missingShell = createWorker("/");
  const completeShell = createWorker("/", { cacheContainsAll: true });

  const missingStatus = await requestStatus(missingShell, "missing");
  const completeStatus = await requestStatus(completeShell, "complete");

  assert.equal(missingStatus.requestId, "missing");
  assert.equal(missingStatus.cacheReady, false);
  assert.equal(completeStatus.requestId, "complete");
  assert.equal(completeStatus.cacheReady, true);
});

test("status safely repairs an evicted shell matching the active revision", async () => {
  const worker = createWorker("/", {
    fetchResponse(request) {
      const url = new URL(request.url);
      if (request.method === "HEAD") return new Response(null, { status: 200 });
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(
          '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
        );
      }
      return new Response(`asset:${url.pathname}`);
    },
  });

  const status = await requestStatus(worker, "repair");
  assert.equal(status.cacheReady, true);

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
  assert.match(await response.text(), /app\.js\?v=0\.5\.4-dev\.36/);
});

test("missing controlled navigation repairs the matching active shell", async () => {
  const worker = createWorker("/", {
    fetchResponse(request) {
      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(
          '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
        );
      }
      return new Response(`asset:${url.pathname}`);
    },
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
  assert.match(await response.text(), /app\.js\?v=0\.5\.4-dev\.36/);
  assert.equal((await requestStatus(worker)).cacheReady, true);
});

test("partial controlled-navigation eviction repairs before serving the index", async () => {
  const indexUrl = "https://example.test/index.html";
  const appUrl = "https://example.test/app.js?v=0.5.4-dev.36";
  const cachedResponses = new Map([
    [
      indexUrl,
      new Response(
        '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
      ),
    ],
  ]);
  const worker = createWorker("/", {
    cachedResponses,
    fetchResponse(request) {
      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(
          '<link href="styles.css?v=0.5.4-dev.36"><script src="app.js?v=0.5.4-dev.36"></script>',
        );
      }
      return new Response(`asset:${url.pathname}`);
    },
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
  assert.match(await response.text(), /app\.js\?v=0\.5\.4-dev\.36/);
  assert.equal(cachedResponses.has(appUrl), true);
  assert.equal((await requestStatus(worker)).cacheReady, true);
});
