import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the managed product version is consistently declared", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.version, "0.5.4");
  assert.match(read("README.md"), /development baseline is `0\.5\.4`/);
  assert.match(
    read("docs/ROADMAP.md"),
    /Current baseline: \*\*0\.5\.4 development\*\*/,
  );
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
  const revision = "0.5.4-dev.30";
  const revisionPattern = revision.replaceAll(".", "\\.");
  assert.match(html, new RegExp(`href="styles\\.css\\?v=${revisionPattern}"`));
  assert.match(html, new RegExp(`src="app\\.js\\?v=${revisionPattern}"`));
  for (const module of [
    "public/app.js",
    "public/lib/project-format.js",
    "public/lib/simulation.js",
    "public/lib/storage.js",
  ]) {
    assert.match(read(module), new RegExp(`\\.js\\?v=${revisionPattern}`));
  }
  assert.match(
    read("public/app.js"),
    new RegExp(`save-queue\\.js\\?v=${revisionPattern}`),
  );
  assert.match(
    read("public/app.js"),
    new RegExp(`diagnostics\\.js\\?v=${revisionPattern}`),
  );
  assert.match(
    read("public/app.js"),
    new RegExp(`browser-runtime\\.js\\?v=${revisionPattern}`),
  );
  assert.match(
    read("public/app.js"),
    /serviceWorker\.register\(\s*"\.\/service-worker\.js"/,
  );
  assert.doesNotMatch(
    read("public/app.js"),
    /serviceWorker\.register\(\s*[`'"]\.\/service-worker\.js\?v=/,
  );
  const worker = read("public/service-worker.js");
  assert.match(worker, new RegExp(`SHELL_REVISION = "${revisionPattern}"`));
  for (const asset of [
    "styles.css",
    "app.js",
    "lib/batch-core.js",
    "lib/browser-runtime.js",
    "lib/diagnostics.js",
    "lib/project-format.js",
    "lib/save-queue.js",
    "lib/simulation.js",
    "lib/storage.js",
  ]) {
    assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=`));
  }
  assert.match(read("public/app.js"), /if \(saveResult\.status === "saved"\)/);
  assert.doesNotThrow(() => read("public/styles.css"));
  assert.doesNotThrow(() => read("public/app.js"));
  assert.doesNotThrow(() => read("public/lib/save-queue.js"));
  assert.doesNotThrow(() => read("public/lib/diagnostics.js"));
  assert.doesNotThrow(() => read("public/lib/browser-runtime.js"));
  assert.doesNotThrow(() => read("public/service-worker.js"));
});

test("the human-facing roadmap records the delivery and result policies", () => {
  const roadmap = read("docs/ROADMAP.md");
  assert.match(
    roadmap,
    /All work is performed in a branch or dedicated worktree/,
  );
  assert.match(roadmap, /reaches\s+`main` only after required CI succeeds/);
  assert.match(
    roadmap,
    /pull-request comments and review\s+threads are inspected, actionable feedback is addressed, and every thread is\s+resolved/,
  );
  assert.match(roadmap, /\.agent\/test-results\//);
  assert.match(
    roadmap,
    /Code changes and major rework receive challenged adversarial review/,
  );
  assert.match(
    read("docs/HUMAN_TESTING.md"),
    /Simple documentation and progress-only updates are exempt/,
  );
  assert.match(
    read("docs/HUMAN_TESTING.md"),
    /all pull-request comments and review\s+threads are addressed and resolved/,
  );
  assert.match(
    roadmap,
    /Formal Git tags and GitHub releases begin at `1\.0\.0`/,
  );
});

test("pre-1.0 CI validates builds without publishing review artifacts", () => {
  const ci = read(".github/workflows/ci.yml");
  const playwright = read("playwright.config.js");
  assert.equal(existsSync(join(root, ".github/workflows/release.yml")), false);
  assert.doesNotMatch(ci, /upload-artifact|release candidate/i);
  assert.match(ci, /playwright install --with-deps chromium firefox webkit/);
  assert.match(playwright, /name: "chromium"/);
  assert.match(playwright, /name: "firefox"/);
  assert.match(playwright, /name: "webkit"/);
  assert.match(ci, /npm run verify:reproducible/);
  assert.match(ci, /BATFLOW_WEB_ROOT=dist/);
});
