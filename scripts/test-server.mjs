import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const port = Number(process.env.BATFLOW_TEST_SERVER_PORT || 41740);
const root = path.resolve(process.cwd(), "public");
const offlineCookie = "batflow-test-offline=1";
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

const server = createServer(async (request, response) => {
  if (request.headers.cookie?.includes(offlineCookie)) {
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Simulated test outage.");
    return;
  }

  const filename = responsePath(request.url);
  if (!filename) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    if (!(await stat(filename)).isFile()) throw new Error("Not a file");
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
