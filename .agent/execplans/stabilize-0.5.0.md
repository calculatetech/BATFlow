# Stabilize BATFlow 0.5.0 for human release testing

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this work, BATFlow has a release candidate that can safely import, edit,
simulate, persist, and export supported UTF-8 BAT projects without silently
discarding work or presenting stale control-flow results. A clean checkout can
run deterministic unit and browser tests, package only the public application,
and produce a release archive whose version and checksum are known.

The result stops before `main` merge and `v0.5.0` tagging. A human must exercise
the packaged application, approve the draft pull request, and authorize the
release tag.

## Progress

- [x] (2026-07-27 00:47Z) Created
      `milestone/0.5.0-stabilization` in a dedicated worktree from approved `main`.
- [x] (2026-07-27 00:47Z) Recorded the decision-complete stabilization plan.
- [x] (2026-07-27 01:05Z) Extracted pure parsing, resolution, identity, and
      simulation modules.
- [x] (2026-07-27 01:05Z) Added unit regressions for all P0/P1 parser and
      simulator findings.
- [x] (2026-07-27 01:05Z) Added a versioned project envelope and legacy
      migration.
- [x] (2026-07-27 01:05Z) Replaced browser storage with a stable,
      error-reporting migration-aware
      adapter.
- [x] (2026-07-27 01:05Z) Integrated safe destructive actions, durable source
      editing, and automatic
      trace recalculation in the UI.
- [x] (2026-07-27 01:05Z) Added browser acceptance, accessibility, packaging,
      and release checks.
- [x] (2026-07-27 01:05Z) Reconciled documentation, changelog, assessment
      dispositions, and roadmap.
- [x] (2026-07-27 01:11Z) Packaged and verified a reproducible local release
      candidate under Node 24.
- [ ] Push and open a draft release-candidate pull request; obtain green remote
      CI.
- [ ] Obtain human browser/data-migration verification and approval.

## Surprises & Discoveries

- Observation: The private acceptance fixture cannot be used in GitHub CI.
  Evidence: Repository policy intentionally ignores `docs/private/`; all public
  tests must use the tracked synthetic fixtures.

- Observation: The initially selected Markdown CLI brought a high-severity
  transitive advisory into development dependencies.
  Evidence: `npm audit` identified `markdownlint-cli2` through `js-yaml`; the
  package was removed and the final audit reports zero vulnerabilities.

- Observation: Browser persistence tests must wait for the visible completed
  save state rather than merely observing the debounce start.
  Evidence: An initial reload test recovered the prior revision when it
  reloaded at `Unsaved changes`; waiting for `Saved` makes the user-visible
  contract and test deterministic.

- Observation: DEFLATE output differed between the local Node 22 zlib and the
  required Node 24 zlib despite fixed archive order and timestamps.
  Evidence: the initial checksums differed across runtimes; storing the small
  static files without compression now produces the same checksum under both.

## Decision Log

- Decision: Support UTF-8 text with detected/preserved line-ending style in
  0.5.0 and explicitly reject undecodable input.
  Rationale: Browser text decoding cannot honestly infer legacy DOS code pages;
  a narrow documented policy prevents silent corruption.
  Date/Author: 2026-07-27 / Codex

- Decision: Use product version `0.5.0`, project format version `1`, IndexedDB
  schema version `1`, and interpreter profile `msdos-7.1-command.com`.
  Rationale: These version domains change independently.
  Date/Author: 2026-07-27 / Codex

- Decision: Store a durable ID per source line in project metadata and reconcile
  IDs through source edits using unchanged-line anchors plus positional
  replacement pairing.
  Rationale: Notes and simulation outcomes must survive insertions, deletions,
  and edits without binding to a different command.
  Date/Author: 2026-07-27 / Codex

- Decision: Keep the static application dependency-free at runtime and expose
  pure ES modules directly to both the browser and Node tests.
  Rationale: This preserves simple Synology/static hosting while enabling
  deterministic unit coverage.
  Date/Author: 2026-07-27 / Codex

- Decision: Support legacy unversioned BATFlow project JSON and best-effort
  storage migration from `batflow-v1`, `passes`, and `passes-v1`; retain legacy
  stores after copying.
  Rationale: The exact `passes` artifact is unavailable, so reversible copying
  is safer than deletion or invented transformations.
  Date/Author: 2026-07-27 / Codex

## Outcomes & Retrospective

The local release candidate now passes static checks, 25 Node tests, three
Chromium acceptance tests including an axe accessibility scan, HTTP boundary
checks, and deterministic archive verification. The remaining work is remote
CI plus human verification of the exact archive; no merge or release tag has
occurred.

## Context and Orientation

BATFlow is a static application in `public/`. `public/index.html` loads one
global script, `public/app.js`, which currently mixes parsing, simulation,
IndexedDB, rendering, and event wiring. `package.json` provides minimal Node
checks. `tests/fixtures/synthetic/` contains public, invented BAT and CONFIG.SYS
inputs. `docs/PROJECT_ASSESSMENT.md` contains the baseline audit, and
`docs/ROADMAP.md` is the human-facing release status.

The application currently stores one raw project object under key `current` in
IndexedDB database `batflow-v1`. Exported JSON is that raw object. Blocks are
identified by file path plus line number, so metadata moves to unrelated lines
after structural edits. Simulation consumes values from DOM controls and can
continue with stale traces.

A project envelope is a JSON object containing format/version metadata plus the
project payload. A durable line ID is an opaque UUID stored beside a source
line. A release artifact is a deterministic archive assembled from `public/`
only.

## Plan of Work

First, introduce pure modules under `public/lib/`. `batch-core.js` owns source
splitting, line-ending detection, tokenization, parsing, CONFIG.SYS parsing,
validation, target resolution, and line-ID reconciliation. `simulation.js`
owns outcome-request discovery and single-file control-flow simulation.
`project-format.js` owns creation, validation, migration, and serialization of
the version-1 project envelope. `storage.js` owns the one shared IndexedDB
connection and best-effort legacy database migration.

Refactor `public/app.js` into an ES module that consumes those interfaces.
Create/import operations assign project and line IDs. Source changes flow
through one update function that reconciles line IDs, marks the trace inputs
changed, saves, reparses, and recalculates the trace when tracing is enabled.
Block duplicate/delete/edit operations update source and line IDs atomically.

Replace silent replacement actions with confirmation gates. Import reads bytes,
accepts UTF-8 with or without BOM, detects line endings, and rejects decoding
or schema failures without changing current state. Project import accepts
format version 1 plus the documented unversioned legacy shape. Export emits the
versioned envelope.

Implement simulator regressions: strip `@` before classification; tokenize
quoted operands; prohibit basename fallback for qualified targets; group
consecutive labels; request CHOICE/external/pipeline outcomes when their result
feeds the next meaningful `IF ERRORLEVEL`; set a distinct step-limit result;
handle conditional GOTO, SET, CALL, direct transfer, and EXIT semantics; and
include the source revision in trace results so stale rows cannot remain.

Add Node unit tests for pure modules and Playwright browser tests for startup,
imports, persistence, replacement confirmation, trace recalculation,
project round-trip, accessibility-critical keyboard navigation, and staged-site
content boundaries. Add ESLint, Prettier, HTML validation, Markdown checks, and
Playwright as locked development dependencies.

Add a package script that copies only runtime assets into `dist/`, normalizes
archive timestamps/order, creates a deterministic `batflow-0.5.0.zip`, and
writes a SHA-256 checksum under ignored local results or CI runner temporary
storage. A release workflow runs only on `v*` tags, verifies tag/version
agreement, runs the full suite, and publishes the exact artifact and checksum.

Finally, add `CHANGELOG.md`, compatibility/project-format documentation, and a
human test checklist. Update the roadmap to mark automated stabilization
complete and human release verification pending. Update baseline assessment
findings with concise dispositions without deleting the original evidence.

## Concrete Steps

Work from:

    cd /home/mbeutler/Projects/batflow-worktrees/v0.5.0-stabilization

Install the locked environment and run all checks:

    npm ci
    npm run check

Run browser acceptance:

    npm run test:e2e

Package and verify:

    npm run package
    npm run verify:package

Store detailed local output only under:

    .agent/test-results/

Before publishing, require:

    git diff --check
    git status --short
    git ls-files docs/private .agent/test-results

The last command must return no paths.

## Validation and Acceptance

Unit acceptance requires fixtures proving prefixed commands, quoted paths,
qualified/unqualified batch targets, consecutive labels, CHOICE outcomes,
conditional transfers, EXIT, long loops, and durable IDs. Every baseline P0/P1
functional finding must have a named regression.

Project acceptance requires version-1 export/import round-trip, rejection of
invalid/future JSON without state replacement, migration of the legacy raw
shape, CRLF/LF preservation, and non-destructive migration from each known
legacy database name.

Browser acceptance requires the app to start empty, import synthetic BAT and
CONFIG.SYS files, trace both CHOICE outcomes, preserve notes after inserted and
deleted lines, recalculate after source edits and file changes, survive reload,
confirm destructive replacement, and export/reimport the same project.

Packaging acceptance requires `/` plus every referenced runtime asset to return
HTTP 200 from `dist/`; repository, private, test, and documentation paths must
return 404. Two consecutive package runs from the same commit must produce the
same SHA-256 checksum.

CI acceptance requires all checks to succeed on the pushed branch. The draft PR
must remain unmerged until a human completes `docs/HUMAN_TESTING.md`.

## Idempotence and Recovery

All migrations copy data and leave legacy databases untouched. Project import
validates before replacing state. Packaging recreates ignored `dist/` and
result directories. Tests use isolated browser contexts and database names.
If a refactor causes regressions, revert only the current branch commit; `main`
and private local fixtures remain untouched in separate worktrees.

## Artifacts and Notes

Detailed logs, screenshots, Playwright output, archives, and checksums belong
under `.agent/test-results/` locally or the CI runner temporary directory. Do
not commit them.

## Interfaces and Dependencies

`batch-core.js` exports:

    splitSource(text)
    reconcileLineIds(oldLines, oldIds, newLines, makeId)
    parseBatch(text, path, options)
    parseConfigSys(text, path)
    resolveBatchTarget(target, callerPath, projectFiles)

`simulation.js` exports:

    collectOutcomeRequests(parsed)
    simulate(parsed, scenario, options)

`project-format.js` exports:

    createProject(name)
    importProjectDocument(value)
    exportProjectDocument(project)
    validateProject(project)
    updateFileContent(project, path, text)

`storage.js` exports:

    loadCurrentProject()
    saveCurrentProject(project)

The runtime has no third-party dependencies. Development dependencies are
locked and used only for static checks and browser tests.

Current revision note: The implementation and local automated gates are
complete. The plan stops at the intended remote-CI and human-approval boundary.
