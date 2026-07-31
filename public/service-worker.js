const SHELL_REVISION = "0.5.4-dev.29";
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
        if (cached) return cached;
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
        let offline = false;
        try {
          const probe = await fetch(
            new Request(
              new URL(
                `service-worker.js?connectivity=${Date.now()}`,
                SCOPE_URL,
              ),
              { cache: "no-store", method: "HEAD" },
            ),
          );
          if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
        } catch {
          offline = true;
        }
        const cache = await caches.open(CACHE_NAME);
        const cachedShell = await Promise.all(
          SHELL_URLS.map((url) => cache.match(url)),
        );
        source?.postMessage({
          type: "BATFLOW_STATUS",
          requestId: event.data.requestId,
          cacheReady: cachedShell.every(Boolean),
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
