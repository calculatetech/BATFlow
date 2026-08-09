import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the rebuild is a static memory-only application", () => {
  const manifest = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(manifest.version, "0.6.3");
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].version, manifest.version);
  for (const path of [
    "public/index.html",
    "public/app.js",
    "public/lib/config.js",
    "public/lib/flow.js",
    "public/lib/simulate.js",
  ]) {
    for (const match of read(path).matchAll(/\?v=([\d.]+)/g)) {
      assert.equal(match[1], manifest.version, `${path} has a stale cache key`);
    }
  }
  assert.doesNotMatch(
    read("public/app.js"),
    /indexedDB|serviceWorker|localStorage|sessionStorage|\.batflow/i,
  );
  for (const removed of [
    "public/service-worker.js",
    "public/lib/storage.js",
    "public/lib/project-format.js",
  ]) {
    assert.equal(existsSync(join(root, removed)), false);
  }
});

test("private sources and generated results remain excluded", () => {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", "docs/private", ".agent/test-results"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(tracked.trim(), "");
});

test("the numbered rebuild roadmap retains all focused tasks", () => {
  const roadmap = read("docs/ROADMAP.md");
  for (let number = 1; number <= 8; number += 1) {
    assert.match(roadmap, new RegExp(`BF-${String(number).padStart(3, "0")}`));
  }
});
