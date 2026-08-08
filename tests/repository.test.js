import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the managed baseline and rebuild target are declared", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.version, "0.5.3");
  assert.match(read("README.md"), /development baseline is `0\.5\.3`/);
  assert.match(read("docs/ROADMAP.md"), /BATFlow 0\.6\.0 rebuild roadmap/);
});

test("private inputs and generated results are excluded from Git", () => {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", "docs/private", ".agent/test-results"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(tracked.trim(), "");

  for (const path of [
    "docs/private/AUTOEXEC.BAT",
    "docs/private/CONFIG.SYS",
    ".agent/test-results/smoke.json",
  ]) {
    execFileSync("git", ["check-ignore", "--quiet", path], { cwd: root });
  }

  const shippedFixtures = readdirSync(join(root, "public")).filter((name) =>
    /\.(?:bat|sys)$/i.test(name),
  );
  assert.deepEqual(shippedFixtures, []);
});

test("tracked BAT and SYS fixtures are explicitly synthetic and test-only", () => {
  const fixtureDirectory = join(root, "tests/fixtures/synthetic");
  const fixtures = readdirSync(fixtureDirectory).filter((name) =>
    /\.(?:bat|sys)$/i.test(name),
  );

  assert.deepEqual(fixtures.sort(), ["basic-flow.bat", "menu-config.sys"]);
  for (const fixture of fixtures) {
    assert.match(
      readFileSync(join(fixtureDirectory, fixture), "utf8"),
      /SYNTHETIC BATFLOW TEST FIXTURE/,
    );
  }
});

test("the public UI has no private example loader or in-app roadmap", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");

  assert.doesNotMatch(html, /loadExample|data-view="roadmap"|roadmapView/);
  assert.doesNotMatch(app, /loadExample|renderRoadmap|roadmapView/);
  assert.doesNotMatch(
    app,
    /fetch\(\s*['"](?:AUTOEXEC\.BAT|CONFIG\.SYS|ROADMAP\.md)['"]/i,
  );
});

test("the public HTML references only present runtime assets", () => {
  const html = read("public/index.html");
  assert.match(html, /href="styles\.css\?v=0\.5\.3-dev"/);
  assert.match(html, /src="app\.js\?v=0\.5\.3-dev"/);
  for (const module of [
    "public/app.js",
    "public/lib/project-format.js",
    "public/lib/simulation.js",
    "public/lib/storage.js",
  ]) {
    assert.match(read(module), /\.js\?v=0\.5\.3-dev/);
  }
  assert.match(read("public/app.js"), /save-queue\.js\?v=0\.5\.3-dev/);
  assert.match(read("public/app.js"), /diagnostics\.js\?v=0\.5\.3-dev/);
  assert.match(read("public/app.js"), /if \(saveResult\.status === "saved"\)/);
  assert.doesNotThrow(() => read("public/styles.css"));
  assert.doesNotThrow(() => read("public/app.js"));
  assert.doesNotThrow(() => read("public/lib/save-queue.js"));
  assert.doesNotThrow(() => read("public/lib/diagnostics.js"));
});

test("the human-facing roadmap records the delivery and result policies", () => {
  const roadmap = read("docs/ROADMAP.md");
  for (const task of Array.from(
    { length: 8 },
    (_, index) => `BF-${String(index + 1).padStart(3, "0")}`,
  )) {
    assert.match(roadmap, new RegExp(task));
  }
  assert.match(roadmap, /one .*outcome per pull request/i);
  assert.match(roadmap, /required `verify` check/i);
  assert.match(roadmap, /Resolve every review thread before merge/);
  assert.match(roadmap, /final integration pull request\s+targets `main`/);
});

test("pre-1.0 CI validates builds without publishing review artifacts", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.equal(existsSync(join(root, ".github/workflows/release.yml")), false);
  assert.doesNotMatch(ci, /upload-artifact|release candidate/i);
  assert.match(ci, /npm run verify:reproducible/);
  assert.match(ci, /BATFLOW_WEB_ROOT=dist/);
});
