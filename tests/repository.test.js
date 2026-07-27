'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the managed product version is consistently declared', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.version, '0.5.0');
  assert.match(read('README.md'), /release, `0\.5\.0`/);
  assert.match(read('docs/ROADMAP.md'), /Current target: \*\*stable 0\.5\.0\*\*/);
});

test('private inputs and generated results are excluded from Git', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', 'docs/private', '.agent/test-results'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(tracked.trim(), '');

  for (const path of [
    'docs/private/AUTOEXEC.BAT',
    'docs/private/CONFIG.SYS',
    '.agent/test-results/smoke.json',
  ]) {
    execFileSync('git', ['check-ignore', '--quiet', path], { cwd: root });
  }

  const shippedFixtures = readdirSync(join(root, 'public')).filter((name) =>
    /\.(?:bat|sys)$/i.test(name),
  );
  assert.deepEqual(shippedFixtures, []);
});

test('tracked BAT and SYS fixtures are explicitly synthetic and test-only', () => {
  const fixtureDirectory = join(root, 'tests/fixtures/synthetic');
  const fixtures = readdirSync(fixtureDirectory).filter((name) =>
    /\.(?:bat|sys)$/i.test(name),
  );

  assert.deepEqual(fixtures.sort(), ['basic-flow.bat', 'menu-config.sys']);
  for (const fixture of fixtures) {
    assert.match(
      readFileSync(join(fixtureDirectory, fixture), 'utf8'),
      /SYNTHETIC BATFLOW TEST FIXTURE/,
    );
  }
});

test('the public UI has no private example loader or in-app roadmap', () => {
  const html = read('public/index.html');
  const app = read('public/app.js');

  assert.doesNotMatch(html, /loadExample|data-view="roadmap"|roadmapView/);
  assert.doesNotMatch(app, /loadExample|renderRoadmap|roadmapView/);
  assert.doesNotMatch(
    app,
    /fetch\(\s*['"](?:AUTOEXEC\.BAT|CONFIG\.SYS|ROADMAP\.md)['"]/i,
  );
});

test('the public HTML references only present runtime assets', () => {
  const html = read('public/index.html');
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="app\.js"/);
  assert.doesNotThrow(() => read('public/styles.css'));
  assert.doesNotThrow(() => read('public/app.js'));
});

test('the human-facing roadmap records the delivery and result policies', () => {
  const roadmap = read('docs/ROADMAP.md');
  assert.match(roadmap, /All work is performed in a branch or dedicated worktree/);
  assert.match(roadmap, /No change reaches `main` until CI succeeds and a human verifies it/);
  assert.match(roadmap, /\.agent\/test-results\//);
  assert.match(roadmap, /annotated tag `v0\.5\.0`/);
});
