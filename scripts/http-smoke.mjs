import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const port = Number(process.env.BATFLOW_SMOKE_PORT || 41739);
const webRoot = process.env.BATFLOW_WEB_ROOT || "public";
const resultDirectory = path.resolve(
  root,
  process.env.BATFLOW_TEST_RESULTS_DIR || ".agent/test-results",
);
await mkdir(resultDirectory, { recursive: true });

const serverLog = await open(
  path.join(resultDirectory, "http-server.log"),
  "w",
);
const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(port),
    "--bind",
    "127.0.0.1",
    "--directory",
    webRoot,
  ],
  {
    cwd: root,
    stdio: ["ignore", serverLog.fd, serverLog.fd],
  },
);

const baseUrl = `http://127.0.0.1:${port}`;
const summary = {
  baseUrl,
  checks: [],
  completedAt: null,
};

async function request(pathname, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`);
  summary.checks.push({ pathname, status: response.status });
  assert.equal(response.status, expectedStatus, pathname);
  return response;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, "static server did not become ready");

  const index = await (await request("/", 200)).text();
  assert.match(index, /<title>BATFlow/);
  assert.match(index, /src="app\.js\?v=0\.5\.4-dev\.29"/);
  assert.match(index, /href="styles\.css\?v=0\.5\.4-dev\.29"/);

  await request("/app.js", 200);
  await request("/service-worker.js", 200);
  await request("/styles.css", 200);
  await request("/lib/browser-runtime.js", 200);
  await request("/lib/diagnostics.js", 200);
  await request("/.git/config", 404);
  await request("/docs/private/AUTOEXEC.BAT", 404);
  await request("/AUTOEXEC.BAT", 404);
  await request("/CONFIG.SYS", 404);
  await request("/ROADMAP.md", 404);

  summary.completedAt = new Date().toISOString();
  await writeFile(
    path.join(resultDirectory, "http-smoke.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`HTTP smoke checks passed; details: ${resultDirectory}`);
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }
    server.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
  await serverLog.close();
}
