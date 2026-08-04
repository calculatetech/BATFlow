const SHELL_REVISION = "0.5.4-dev.37";
const SCOPE_URL = new URL("./", globalThis.location.href);
const CACHE_PREFIX = `batflow-shell-scope:${encodeURIComponent(
  SCOPE_URL.pathname,
)}:revision:`;
const CACHE_NAME = `${CACHE_PREFIX}${SHELL_REVISION}`;
const INDEX_URL = new URL("index.html", SCOPE_URL).href;
const SHELL_URLS = [
  "./",
  "index.html",
  `styles.css?v=${SHELL_REVISION}`,
  `app.js?v=${SHELL_REVISION}`,
  `lib/batch-core.js?v=${SHELL_REVISION}`,
  `lib/browser-runtime.js?v=${SHELL_REVISION}`,
  `lib/diagnostics.js?v=${SHELL_REVISION}`,
  `lib/project-format.js?v=${SHELL_REVISION}`,
  `lib/save-queue.js?v=${SHELL_REVISION}`,
  `lib/simulation.js?v=${SHELL_REVISION}`,
  `lib/storage.js?v=${SHELL_REVISION}`,
].map((path) => new URL(path, SCOPE_URL).href);
const VERSIONED_SHELL_URLS = new Set(
  SHELL_URLS.filter((url) => new URL(url).searchParams.has("v")),
);
let shellRecoveryPromise = null;

async function cacheContainsCompleteShell(cache) {
  const cachedShell = await Promise.all(
    SHELL_URLS.map((url) => cache.match(url)),
  );
  if (!cachedShell.every(Boolean)) return false;
  return indexMatchesActiveRevision(await cache.match(INDEX_URL));
}

async function indexMatchesActiveRevision(response) {
  if (!response?.ok) return false;
  const indexText = await response.clone().text();
  return (
    indexText.includes(`app.js?v=${SHELL_REVISION}`) &&
    indexText.includes(`styles.css?v=${SHELL_REVISION}`)
  );
}

async function repairActiveShell(cache) {
  const requests = SHELL_URLS.map(
    (url) =>
      new Request(url, {
        cache: "reload",
        credentials: "same-origin",
      }),
  );
  const networkIndex = await fetch(
    new Request(INDEX_URL, {
      cache: "reload",
      credentials: "same-origin",
    }),
  );
  if (!(await indexMatchesActiveRevision(networkIndex))) return false;
  await cache.addAll(requests);
  const cachedIndex = await cache.match(INDEX_URL);
  if (!(await indexMatchesActiveRevision(cachedIndex))) {
    await Promise.all(SHELL_URLS.map((url) => cache.delete(url)));
    return false;
  }
  return cacheContainsCompleteShell(cache);
}

function recoverActiveShell(cache) {
  if (shellRecoveryPromise === null) {
    shellRecoveryPromise = repairActiveShell(cache).finally(() => {
      shellRecoveryPromise = null;
    });
  }
  return shellRecoveryPromise;
}

async function originIsReachable() {
  const probeUrl = new URL(
    `service-worker.js?connectivity=${Date.now()}`,
    SCOPE_URL,
  );
  try {
    const response = await fetch(
      new Request(probeUrl, { cache: "no-store", method: "HEAD" }),
    );
    if (response.ok) return true;
    if (response.status !== 405 && response.status !== 501) return false;
    const fallback = await fetch(
      new Request(probeUrl, { cache: "no-store", method: "GET" }),
    );
    return fallback.ok;
  } catch {
    return false;
  }
}

globalThis.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(
        SHELL_URLS.map(
          (url) =>
            new Request(url, {
              cache: "reload",
              credentials: "same-origin",
            }),
        ),
      ),
    ),
  );
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
              )
              .map((name) => caches.delete(name)),
          ),
        ),
      globalThis.clients.claim(),
    ]),
  );
});

globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(INDEX_URL);
        if (cached && (await cacheContainsCompleteShell(cache))) return cached;
        try {
          if (await recoverActiveShell(cache)) {
            return (await cache.match(INDEX_URL)) || Response.error();
          }
        } catch {
          // An unavailable or mismatched origin must not mix shell revisions.
        }
        return Response.error();
      })(),
    );
    return;
  }

  if (VERSIONED_SHELL_URLS.has(url.href)) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) =>
          cache.match(request).then((cached) => cached || Response.error()),
        ),
    );
  }
});

globalThis.addEventListener("message", (event) => {
  if (event.data?.type === "BATFLOW_STATUS_REQUEST") {
    const source = event.source;
    event.waitUntil(
      (async () => {
        const offline = !(await originIsReachable());
        const cache = await caches.open(CACHE_NAME);
        let cacheReady = await cacheContainsCompleteShell(cache);
        if (!cacheReady && !offline) {
          try {
            cacheReady = await recoverActiveShell(cache);
          } catch {
            cacheReady = false;
          }
        }
        source?.postMessage({
          type: "BATFLOW_STATUS",
          requestId: event.data.requestId,
          cacheReady,
          offline,
          shellRevision: SHELL_REVISION,
        });
      })(),
    );
    return;
  }
  if (event.data?.type === "BATFLOW_ACTIVATE") {
    event.waitUntil(globalThis.skipWaiting());
  }
});
