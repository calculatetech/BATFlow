# BATFlow

BATFlow is a static, client-side visual editor and control-flow simulator for
Win98 MS-DOS 7.1 batch files.

The current managed development baseline is `0.5.0`. BATFlow was formerly
called `passes`. Pre-1.0 development uses structured `0.x` versions without
formal Git tags or GitHub releases.

## Run locally

From the repository root:

```sh
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`.

Only `public/` is a deployable web root. Do not serve the repository root.

## Develop and verify

Node.js 24 is required. From a clean checkout:

```sh
npm ci
npx playwright install chromium
npm run check
npm run test:e2e
npm run package
npm run verify:package
npm run verify:reproducible
```

Generated archives, checksums, browser traces, and detailed results are written
under ignored `.agent/test-results/`. `dist/` is also generated and ignored.

## Current capabilities

- Browser-local IndexedDB project persistence
- Multi-file BAT, CONFIG.SYS, and text import
- Label-oriented flow diagrams and source/split views
- Blocks for conditions, jumps, calls, variables, pipelines, comments,
  interpreter commands, and external commands
- Basic Win98 syntax validation
- Variable, path-existence, and flow-relevant ERRORLEVEL simulation inputs
- Single-file control-flow traces with dynamic GOTO support
- Block editing, duplication, deletion, and manual notes
- `.batflow` project export and individual file export

The supported text boundary is UTF-8 with CRLF, LF, or CR line endings; BATFlow
does not guess legacy DOS code pages. Review the
[compatibility boundary](docs/COMPATIBILITY.md), [project format](docs/PROJECT_FORMAT.md),
[roadmap](docs/ROADMAP.md), and baseline
[project assessment](docs/PROJECT_ASSESSMENT.md).

## Development policy

All changes are developed in branches or worktrees. Nothing is merged until
the relevant CI checks pass and a human verifies the result.

Human review is performed against the uncommitted worktree before the reviewed
tree is committed. CI artifacts are not a substitute for that review.

Private test inputs belong in the ignored `docs/private/` directory. Tracked
tests use deliberately synthetic fixtures under `tests/fixtures/synthetic/`.
Detailed local test output belongs in the ignored `.agent/test-results/`
directory and must not be committed.
