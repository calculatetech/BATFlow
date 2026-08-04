import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const port = Number(process.env.BATFLOW_TEST_SERVER_PORT || 41740);
const root = path.resolve(process.cwd(), "public");
const offlineCookie = "batflow-test-offline=1";
const newEntryCookie = "batflow-test-new-entry=1";
const probeCounts = new Map();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function responsePath(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${port}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const pathname = requestedPath.startsWith("/batflow/")
    ? requestedPath.slice("/batflow".length)
    : requestedPath;
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function headProbeTest(request) {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(
    /(?:^|;\s*)batflow-test-head-probe=(405|501):([A-Za-z0-9_-]+)/,
  );
  if (!match) return null;
  return { status: Number(match[1]), token: match[2] };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === "/__batflow-test/probe-counts") {
    const counts = probeCounts.get(requestUrl.searchParams.get("token")) || {
      GET: 0,
      HEAD: 0,
    };
    const content = Buffer.from(JSON.stringify(counts));
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": content.length,
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(content);
    return;
  }

  if (request.headers.cookie?.includes(offlineCookie)) {
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Simulated test outage.");
    return;
  }

  const headProbe = headProbeTest(request);
  if (headProbe && requestUrl.searchParams.has("connectivity")) {
    const counts = probeCounts.get(headProbe.token) || { GET: 0, HEAD: 0 };
    if (request.method === "HEAD" || request.method === "GET") {
      counts[request.method] += 1;
      probeCounts.set(headProbe.token, counts);
    }
    if (request.method === "HEAD") {
      response.writeHead(headProbe.status, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
  }

  const filename = responsePath(request.url);
  if (!filename) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    if (!(await stat(filename)).isFile()) throw new Error("Not a file");
    if (
      path.basename(filename) === "index.html" &&
      request.headers.cookie?.includes(newEntryCookie)
    ) {
      const content = Buffer.from(
        "<!doctype html><title>Unactivated</title><body>UNACTIVATED TEST ENTRYPOINT</body>",
      );
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": content.length,
        "Content-Type": contentTypes[".html"],
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    const content = await readFile(filename);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": content.length,
      "Content-Type":
        contentTypes[path.extname(filename)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
