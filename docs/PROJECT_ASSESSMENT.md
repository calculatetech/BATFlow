# BATFlow 0.5.0 project assessment

- Assessment date: 2026-07-26
- Assessed tree: the uncommitted working tree in `/home/mbeutler/Projects/batflow`
- Declared product version: `0.5.0`
- Former product name supplied by the owner: `passes`

## Executive summary

BATFlow is a useful static prototype, but it is not yet a properly managed or verifiable `0.5.0` software project. The repository has no commits, tags, remote, version manifest, changelog, test command, continuous integration (CI), release workflow, or deployable-artifact definition. Before this assessment was added, nothing in the tree recorded `0.5.0` or the former name `passes`; the only version-like identifiers were the conflicting labels `V1`, `Pass 3` through `Pass 5.1`, and the IndexedDB name `batflow-v1`.

The release-management gaps are not merely administrative. Several features marked complete are reproducibly broken:

- The documented start command serves a repository directory listing rather than the app and exposes files under `.git` and `.agent`.
- The in-app Roadmap tab always requests a missing `public/ROADMAP.md`.
- A private acceptance fixture exposed a trace that cannot get past its first
  `CHOICE`/`IF ERRORLEVEL` pair.
- Editing source or switching files leaves the old execution trace displayed.
- Common `@GOTO`, `@SET`, and `@CALL` syntax is parsed as external commands.
- Explicitly wrong batch paths can resolve to unrelated files with the same basename.
- A non-terminating trace can hit the global step limit and be reported as `Completed`.
- New Project, Load Example, and same-name imports can overwrite the only saved project without confirmation or recovery.

Release verdict: **do not describe this tree as a CI-verified release, production-ready editor, or lossless editor.** If `0.5.0` has already been distributed, preserve it as an immutable historical baseline and issue fixes as `0.5.1`; do not silently move or rewrite a `v0.5.0` tag. If it has not been distributed, stabilize this tree, establish CI, and only then create the first `v0.5.0` tag.

## Scope

This assessment covers the work that the README and roadmap say is already included or complete, plus the project-management, CI, and versioning controls requested for the repository. It reviewed:

- `README.md`
- `docs/ROADMAP.md`
- `.agent/PLANS.md`
- `public/index.html`
- `public/styles.css`
- `public/app.js`
- the private boot-file acceptance pair that was present locally during the
  audit and is excluded from Git and release artifacts
- the local Git metadata and the documented static-server behavior

This is a dated baseline assessment. The
[roadmap](ROADMAP.md) is the current human-facing record of completed and
remaining work.

The audit does **not** count explicitly future product features as defects. Cross-file trace expansion, ZIP-based `.batflow` packages, undo/redo, drag ordering, branch exploration, generated labels, and visual CONFIG.SYS editing remain legitimate roadmap scope. Some future items still appear below where their absence compromises a feature already advertised as complete—for example, line-based identities corrupt completed manual notes after edits.

## Method and evidence

The audit used static inspection, Git inspection, syntax checking, HTTP smoke tests, a headless Firefox load, and read-only Node probes against the parser and simulator.

Observed results:

| Check | Result |
| --- | --- |
| `git status --short --branch` | `No commits yet on master`; every repository-owned file is untracked |
| `git remote -v` | No remote configured |
| Git tags and refs | No commits or tags exist |
| `node --check public/app.js` | Passed; this is the only executable source check currently available |
| `python3 -m http.server 8080`, then request `/` | HTTP 200 directory listing, not BATFlow |
| Request `/index.html` | HTTP 404 |
| Request `/public/` | HTTP 200 and app assets load |
| Request `/public/ROADMAP.md` | HTTP 404 |
| Request `/docs/ROADMAP.md` | HTTP 200 |
| Request `/.git/config` while following the root-serving instructions | HTTP 200 |
| Simulate the private outcome-producing acceptance case | Stops at the following `IF ERRORLEVEL`; no outcome input exists for the preceding `CHOICE` |
| Parse `@goto`, `@set`, and `@call` | All three become `external` blocks |
| Parse two consecutive labels | Produces two sections rather than one label group |
| Resolve `missing/FOO.BAT` when only `elsewhere/FOO.BAT` exists | Incorrectly resolves to `elsewhere/FOO.BAT` |
| Trace a 22-block infinite loop | Records 1,000 rows and reports `Completed` |
| Parse `IF EXIST "C:\Program Files\tool.exe" ...` | Splits the operand at the first space |
| Parse `CALL "dir/My Tool.BAT" arg1` | Fails to resolve an existing file |

No project test command could be run because there is no package/tool manifest and no test suite.

## Severity

| Priority | Meaning |
| --- | --- |
| P0 | Release blocker: credible risk of data loss, unsafe deployment, false release provenance, or failure of a central advertised workflow |
| P1 | High: a completed feature is materially incorrect, unverifiable, or not maintainable |
| P2 | Medium: important reliability, usability, accessibility, or documentation defect |
| P3 | Low: localized quality or polish defect |

## Findings index

| ID | Priority | Finding |
| --- | --- | --- |
| RM-01 | P0 | The repository has no history or release provenance |
| RM-02 | P0 | `0.5.0` was not represented in the baseline product or repository |
| RM-03 | P1 | The rename from `passes` has no migration or compatibility record |
| RM-04 | P1 | Product, export-format, and database versions are absent or conflated |
| RM-05 | P1 | There is no repeatable release process or immutable release artifact |
| RM-06 | P1 | There is no tool manifest, lockfile, or pinned toolchain |
| RM-07 | P0 | There is no CI and no automated regression suite |
| RM-08 | P2 | Basic repository governance and hygiene files are absent |
| RM-09 | P1 | The roadmap is a contradictory pass log rather than a reliable current plan |
| OP-01 | P0 | The documented deployment command is wrong and exposes repository internals |
| OP-02 | P1 | The completed in-app roadmap feature is broken |
| OP-03 | P1 | There is no defined production artifact or deployment validation |
| OP-04 | P2 | Browser support, caching, and upgrade behavior are undefined |
| DI-01 | P0 | Destructive actions can irreversibly replace the only saved project |
| DI-02 | P1 | Line-number identities corrupt notes and other state after structural edits |
| DI-03 | P1 | Encoding and line-ending metadata are false and edits normalize content |
| DI-04 | P1 | Project JSON is unversioned and imported without schema validation |
| DI-05 | P1 | IndexedDB writes lack reliable completion/error handling and leak connections |
| DI-06 | P2 | Simulation state is neither project-scoped nor durably persisted |
| DI-07 | P2 | Autosave reparses and starts a database transaction on every keystroke |
| DI-08 | P2 | File/project identity and collision behavior are incomplete |
| FC-01 | P0 | An outcome-producing acceptance case cannot trace its first choice |
| FC-02 | P1 | Traces become stale after edits and file navigation |
| FC-03 | P1 | The parser mishandles the standard command-echo suppression prefix |
| FC-04 | P1 | Quoted paths with spaces are parsed or resolved incorrectly |
| FC-05 | P1 | Batch target fallback violates explicit path intent |
| FC-06 | P1 | The simulator reports some non-terminating flows as completed |
| FC-07 | P1 | Conditional commands and terminating commands are not traced as control flow |
| FC-08 | P2 | Consecutive labels are not label-grouped |
| FC-09 | P2 | The file picker excludes the project format it claims to import |
| FC-10 | P2 | Unsupported file types are accepted and rendered as batch files |
| FC-11 | P2 | Empty/new-project rendering can leave stale panels visible |
| FC-12 | P2 | Import, sample loading, storage, and roadmap failures are mostly silent |
| FC-13 | P3 | A terminal newline is counted as an extra source line |
| QA-01 | P1 | Core logic is a DOM-coupled monolith that is difficult to test safely |
| QA-02 | P2 | Core interactions are not keyboard accessible or semantically labeled |
| QA-03 | P2 | The responsive layout removes the only inspector/editor controls |
| QA-04 | P2 | There is no structured error reporting or diagnostic state |
| QA-05 | P3 | Source formatting and static quality controls are absent |
| DOC-01 | P1 | README and roadmap claims contradict both one another and the code |
| DOC-02 | P1 | README file paths and run instructions are broken |
| DOC-03 | P2 | Architecture, format, compatibility, release, and operations docs are missing |

## Detailed findings

### Release and project management

#### RM-01 — No history or release provenance (P0)

The Git repository is still at its initial unborn branch. Before this assessment was added, all eight repository-owned files were untracked; there is no remote, and no tags exist. Consequently:

- None of the claimed Pass 1 through Pass 5.1 work can be tied to a commit.
- The alleged Pass 5 regression and Pass 5.1 revert cannot be inspected or reproduced from history.
- There is no review trail, author trail, diff, rollback point, or known released source tree.
- A release tag cannot currently identify `0.5.0`.

The prose in `.agent/PLANS.md` requires frequent commits and assumes version control owns revision history, but this project has not followed that policy.

Required disposition: establish one intentional import/baseline commit without fabricating historical commits. Record in `CHANGELOG.md` that earlier pass history predates repository provenance.

#### RM-02 — `0.5.0` is not represented (P0)

Before this assessment, no project or product file contained `0.5.0`. `README.md:1` calls the project a “V1 prototype”; `public/app.js:3` uses the database name `batflow-v1`; `docs/ROADMAP.md` uses Pass numbers; the UI exposes no version. These labels answer different questions but currently look like competing product versions.

A user, support engineer, exported project, deployed server, or CI job cannot determine which BATFlow build created an artifact. The source cannot verify the owner-supplied assertion that the current version is `0.5.0`.

Required disposition: adopt SemVer for product releases with one canonical source of truth. Surface the version in the UI and release artifact. Treat `V1` only as a product-scope label and retire Pass numbers as version identifiers.

#### RM-03 — No `passes` rename record or migration (P1)

The former name `passes` does not occur anywhere in the tree. There is no:

- rename entry in a changelog;
- redirect or repository description;
- legacy export/import compatibility fixture;
- IndexedDB migration from any old database/store name;
- documented legacy filename extension or schema;
- test proving existing `passes` users retain data.

The absence of old identifiers in current branding is good, but erasing all compatibility knowledge makes the rename operationally unsafe. Browser storage is keyed by database name and origin, so a renamed database or deployment origin can strand existing projects.

Required disposition: inventory the last distributed `passes` artifact before changing storage. Document exactly which old database names, store names, project fields, and file extensions existed. Add migration fixtures and tests. If no compatibility is possible, say so prominently and provide an export/recovery procedure.

#### RM-04 — Version domains are missing or conflated (P1)

BATFlow needs at least three independently managed version domains:

| Domain | Purpose | Current state |
| --- | --- | --- |
| Product version | User-visible application release, using SemVer | Missing; owner says `0.5.0` but tree does not |
| Project format version | Determines whether an exported project can be read/migrated | Missing from exported JSON |
| IndexedDB schema version | Drives browser-storage upgrades | Literal `1` in `indexedDB.open()` but undocumented and without migrations |

`DB_NAME = 'batflow-v1'` incorrectly embeds another version-like label in the database name. Changing the database name to `v2` would create a separate database rather than upgrade existing data.

Required disposition: keep a stable database name; increment the IndexedDB numeric version only with tested upgrade handlers. Put an explicit `formatVersion` in every project export. Keep both separate from product `0.5.0`.

#### RM-05 — No repeatable release process (P1)

There is no changelog, release checklist, release workflow, artifact staging directory, checksum, provenance record, or tag/version consistency check. Deploying currently means copying an unspecified subset of the working tree.

Required disposition: define a release artifact containing only public runtime files and intentional static content. A tag-triggered workflow should verify that the tag matches the canonical version, rerun CI, assemble the artifact, smoke-test it, generate checksums, and attach it to an immutable release.

#### RM-06 — No manifest, lockfile, or pinned toolchain (P1)

The app has no runtime dependencies, which is a positive property. The project nevertheless needs a development manifest for reproducible linting, formatting, tests, and packaging. There is no `package.json`, lockfile, Node version declaration, or equivalent.

Without those files, “run the tests” and “build the release” have no stable meanings. Ad hoc global tools will produce different results on different machines.

Required disposition: add a minimal manifest and committed lockfile, pin the supported Node major version, and expose a small, documented script surface such as `format:check`, `lint`, `test:unit`, `test:e2e`, `test`, and `package`.

#### RM-07 — No CI or regression suite (P0)

There is no `.github/workflows`, no test directory, and no test command. The roadmap calls Pass 4.1 “verified” and Pass 5.1 a completed “regression recovery,” but there is no durable evidence or automated gate behind either word.

This gap directly enabled the current missing-roadmap and acceptance-trace failures. The nine regression checks listed at `docs/ROADMAP.md:174-182` are prose only.

Required disposition: block merge/release on static checks, unit tests, and browser-level acceptance tests. The initial suite must reproduce every P0/P1 functional finding in this assessment before fixing it.

#### RM-08 — Missing governance and hygiene (P2)

The repository has no license, contributing guide, security policy, code ownership, issue/PR templates, support policy, or `.gitignore`. The absence of a license leaves downstream usage rights unspecified. The missing ignore file also conflicts with `.agent/PLANS.md`, which says detailed test results under `.agent/test-results/` must never be committed.

Required disposition: add the files appropriate to the intended ownership and distribution model. License selection requires an owner decision and should not be guessed by an implementer.

#### RM-09 — Roadmap is not reliable project state (P1)

`docs/ROADMAP.md` is an append-only narrative with mutually inconsistent current/future sections:

- `docs/ROADMAP.md:14` says the current implementation is Pass 3, while Pass 5.1 is complete later in the same file.
- `docs/ROADMAP.md:43` says every external/pipeline block has an outcome input; lines 114-115 later say only flow-relevant blocks do.
- `docs/ROADMAP.md:57` lists called-file resolution as next work; lines 124-132 later mark it implemented.
- `docs/ROADMAP.md:73` lists direct invocation versus CALL visualization as later work; lines 124-132 mark it implemented.
- The completed Pass 5 section remains phrased as current fact even though Pass 5.1 says it was reverted.

Required disposition: move released changes into `CHANGELOG.md`, retain only present/future work in the roadmap, and track implementation work in issues or self-contained execution plans. Every roadmap item should have an explicit status and acceptance criterion.

### Operations and deployment

#### OP-01 — Documented deployment is wrong and unsafe (P0)

`README.md:7-13` tells the user to serve the repository root and open `/`. In the audited tree:

- `/` returns a directory listing.
- `/index.html` returns 404 because the app lives under `public/`.
- `/.git/config`, `/.agent/PLANS.md`, and `/README.md` are directly downloadable.

The same mistake as a web-server document root can expose repository metadata and any future non-public material. It also fails the most basic documented startup path.

Required disposition: serve only a staged public artifact or use `public/` as the document root. Update the local command accordingly and add an HTTP smoke test asserting `/` is the app while representative private paths are absent.

#### OP-02 — In-app Roadmap is broken (P1)

`public/app.js:508` fetches `ROADMAP.md` relative to the application. The only file is `docs/ROADMAP.md`, so the deployed request `/public/ROADMAP.md` is 404. This contradicts the completed claim at `docs/ROADMAP.md:31` and the Pass 5.1 restoration claim at line 165.

Serving `public/` as the document root does not fix the problem; the file is still outside the artifact.

Required disposition: intentionally copy/render the current roadmap into the release artifact or remove the runtime tab. Add an end-to-end assertion that the tab shows a known heading rather than “Roadmap unavailable.”

#### OP-03 — No production artifact contract (P1)

There is no `dist/`, packaging script, deployment manifest, Nginx example, cache policy, or list of runtime files. The source tree and web root are currently ambiguous. Relative asset paths happen to work under `/public/`, but the expected root, subpath behavior, and roadmap inclusion do not.

Required disposition: define exactly which files are published, stage them into a clean directory, and run all HTTP/browser tests against that directory rather than the repository root.

#### OP-04 — Browser and upgrade behavior are undefined (P2)

The app uses modern browser APIs and syntax including IndexedDB, `crypto.randomUUID`, `Object.hasOwn`, optional chaining, nullish coalescing, logical assignment, `CSS.escape`, and `structured` DOM behavior, but no browser/version support policy exists. Asset cache busting is absent, so an upgraded site may transiently combine an old HTML file with a new script or stylesheet.

Required disposition: publish a browser support matrix based on tested CI browsers. Version static asset URLs or define cache headers that prevent mixed application versions.

### Data integrity and persistence

#### DI-01 — Destructive replacement of the only saved project (P0)

The database stores exactly one record under the key `current` (`public/app.js:46-50`). The following actions mutate and immediately save it without confirmation, backup, conflict UI, or undo:

- New Project replaces the current project with an empty one (`public/app.js:527`).
- Load AUTOEXEC.BAT overwrites files named `AUTOEXEC.BAT` and `CONFIG.SYS` in the current project (`public/app.js:526`).
- File import overwrites any existing file with the same path (`public/app.js:525`).
- Importing project JSON replaces the current in-memory project and then the sole stored record (`public/app.js:525`).

This makes the advertised browser-local persistence a data-loss trap.

Required disposition: require an explicit discard/replace decision when data would be lost, offer export first, and use atomic project records with stable project IDs. Loading the example should create a new named example project or require confirmation before merging.

#### DI-02 — Line-number identity corrupts attached state (P1)

Block IDs are `path + line number` (`public/app.js:9`). Notes are stored against those IDs (`public/app.js:353-357`), while duplication/deletion/full-source edits insert or remove lines without reconciling metadata (`public/app.js:355-361`, `542`). An inserted line causes a note or saved outcome to silently attach to whatever command now occupies the old line number; deletion can do the same immediately.

This contradicts the claim that stable identities are foundational for notes at `docs/ROADMAP.md:88-95`. The roadmap acknowledges durable reconciliation is still future work at line 58, but manual notes are already advertised as complete.

Required disposition: implement durable identity reconciliation before treating notes, selection, outcomes, or trace navigation as reliable. Tests must cover insertion, deletion, duplication, label edits, and full-source replacement.

#### DI-03 — Encoding and line endings are not preserved (P1)

Every imported file is recorded as `{ encoding: 'text', lineEnding: 'CRLF' }` regardless of its actual bytes or line endings (`public/app.js:525`). Browser `File.text()` decodes rather than preserving original bytes. Full-source editing stores the textarea content directly, while block edits normalize the entire file to CRLF (`public/app.js:355-361`, `542`). Export ignores the metadata and writes the current JavaScript string (`public/app.js:529`).

This is partially disclosed in `README.md:33-40` and `docs/ROADMAP.md:70`, but it materially limits the completed import/edit/export workflow and the roadmap’s “lossless raw-command fallback” claim at `docs/ROADMAP.md:12`.

Required disposition: either label the product as text-normalizing and warn before conversion, or preserve original bytes/encoding/line endings with round-trip fixtures. Do not store metadata that was not detected.

#### DI-04 — Unversioned and unchecked project JSON (P1)

Project exports are a raw serialization of `state.project` (`public/app.js:528`) with no `formatVersion`, product version, schema, content limits, checksums, or migration metadata. Import performs `JSON.parse()` and accepts the result as application state without validating its shape (`public/app.js:525`). Syntactically valid JSON with missing or mistyped `files`/`metadata` fields can crash later render/edit paths.

Required disposition: define and document a project schema, validate before replacing current state, reject unsupported future versions, and migrate supported older versions—including any `passes` fixtures—without mutating the current project until validation succeeds.

#### DI-05 — IndexedDB reliability defects (P1)

Each save calls `indexedDB.open()` and never closes the returned database connection (`public/app.js:38-57`). `saveProject()` resolves only on `tx.oncomplete`; it does not reject on transaction error or abort. Most callers do not await or catch it. `loadSavedProject()` converts read errors into “no saved project,” hiding corruption or permission failures.

Repeated source input can therefore accumulate connections, make future upgrades harder, and fail silently. A quota/private-mode/storage error is indistinguishable from a successful save in the UI.

Required disposition: hold one managed connection, handle blocked upgrades, reject failed transactions, surface save state, and test failure paths. A failed load must not be silently treated as an empty project.

#### DI-06 — Simulation state is not properly scoped (P2)

`state.simValues` is global application memory, not part of a project or file (`public/app.js:5`). It is not reset by New Project or project import. It is not exported or persisted. Variables and paths with the same normalized name can leak from one project/file context into another until a render/input cycle happens to replace them.

Required disposition: explicitly decide whether a scenario belongs to a project, file, or transient session; then scope, reset, persist, export, and version it consistently.

#### DI-07 — Unbounded keystroke save/render loop (P2)

Every source textarea input updates the project, opens a database connection/transaction, reparses the file, rebuilds major DOM regions, and starts an asynchronous roadmap fetch (`public/app.js:263-269`, `506-509`, `542`). Save promises are not sequenced or observed.

This will become increasingly fragile on large batch files and makes error behavior nondeterministic.

Required disposition: separate editor state from committed project state, debounce durable saves, avoid refetching static content during render, and expose pending/saved/failed status.

#### DI-08 — Incomplete project and file identity (P2)

The UI never allows the project name to be set, so exports default to `Untitled.batflow.json` (`public/app.js:5`, `528`). The ordinary file input has no directory mode, making `webkitRelativePath` effectively empty in its present use (`public/index.html:17`, `public/app.js:525`). Same-name files overwrite without conflict handling. There is no rename, removal, or explicit boot-file designation despite project metadata existing.

Required disposition: define project/file identity behavior and collision policy. Do not claim nested paths unless an exercised import path can supply them.

### Parser, simulator, and UI correctness

#### FC-01 — Outcome-producing acceptance trace stops at its first choice (P0)

The private fixture contains a `CHOICE` command followed by an
`IF ERRORLEVEL` branch. The parser classifies `choice` as a generic internal
`command` (`public/app.js:12`, `100-106`). Outcome inputs are generated only
for `external` or `pipeline` blocks (`public/app.js:192-198`, `384-387`). The
simulator therefore does not set an ERRORLEVEL for the choice and stops the
following condition as unresolved.

The executable probe produced:

    CHOICE                         command    Would execute
    following IF ERRORLEVEL       condition  Unresolved
    Stop: Input required

This breaks a central outcome-driven workflow and invalidates the baseline
documentation's broad outcome claims.

Required disposition: model flow-relevant outcome producers by behavior rather than the overly broad internal/external rendering category. Synthetic acceptance fixtures need scenarios covering both choice outcomes.

#### FC-02 — Trace state becomes stale (P1)

Simulation reruns after initial load, file import, example load, simulation-input changes, and enabling the toggle. It does **not** rerun or invalidate after:

- block edit, duplication, or deletion;
- full-source edits;
- clicking a different project file;
- opening a resolved called file;
- creating a new project.

Those paths call `render()` while retaining the old `state.trace` (`public/app.js:234-237`, `263-285`, `354-361`, `525-527`, `542`). The trace table can display rows from another file, and line-based IDs can highlight a different edited command.

Required disposition: make parsed source plus scenario inputs the explicit trace inputs. Any change must either recompute the trace or visibly mark it stale and prevent navigation until recalculated.

#### FC-03 — `@` command prefixes are mishandled (P1)

COMMAND.COM batch files commonly prefix commands with `@` to suppress echoing. The generic command-token path strips it, but structural parser branches test the unstripped text first (`public/app.js:67-95`). Executable probes show `@GOTO`, `@SET`, and `@CALL` all become `external`; `@REM` and `@IF` fail for the same reason.

Required disposition: tokenize common line prefixes once before classification while retaining the original source. Add table-driven cases for every supported block kind with and without `@`.

#### FC-04 — Quoted path parsing is broken (P1)

`parseIf()` uses `\S+` for `IF EXIST` operands (`public/app.js:141-143`), so a quoted path with spaces is split into a partial operand and a malformed action. `cleanBatchReference()` strips only boundary quotes from the full target and then splits on whitespace (`public/app.js:200-201`), so a quoted CALL target plus arguments does not resolve.

Required disposition: use one tested DOS-aware tokenizer for command words and quoted arguments. Preserve raw spans so editing does not unnecessarily normalize source.

#### FC-05 — Explicit path intent is discarded (P1)

After exact relative/absolute candidates fail, `resolveBatchTarget()` searches the entire project by basename and accepts a unique match (`public/app.js:211-232`). Thus `CALL missing\FOO.BAT` can resolve to `elsewhere/FOO.BAT`, even though the caller supplied a directory.

This can make validation, links, and transfer traces point at code that COMMAND.COM would not execute.

Required disposition: allow basename fallback only for an unqualified filename if that behavior is part of the selected interpreter profile. Never discard an explicitly supplied path.

#### FC-06 — Infinite flow can report `Completed` (P1)

`runSimulation()` starts with `stop = 'Completed'` and exits after 1,000 loop iterations without changing that result (`public/app.js:418-421`). The per-block “probable loop” threshold only catches shorter loops. A probe with a 22-block loop generated exactly 1,000 trace rows and reported `Completed`.

Required disposition: report a distinct global step-limit result and treat it as incomplete/indeterminate. Cover short loops, long loops, terminal labels, and genuinely completed scripts.

#### FC-07 — Conditional and terminating control flow is incomplete (P1)

For a true IF branch, the simulator implements only an exact `GOTO` and `SET`; every other action is recorded as “Would execute” before execution continues to the next line (`public/app.js:431-441`). A conditional CALL or direct BAT transfer therefore does not transfer control, and an outcome-producing conditional command cannot update a following condition. Separately, an unconditional `EXIT` is classified as an ordinary command and does not terminate the trace (`public/app.js:100-106`, `463`).

These are control-flow effects, so they are inside the stated simulator boundary even though BATFlow never executes DOS commands.

Required disposition: represent supported control-flow actions consistently whether they appear alone or as an IF action. Model termination explicitly. Pause as unsupported/indeterminate when an unmodeled action could affect later control flow rather than claiming to continue accurately.

#### FC-08 — Consecutive labels are not grouped (P2)

The parser begins a new section whenever the current section has either blocks **or labels** (`public/app.js:73-78`). Therefore consecutive labels always create separate sections and `section.labels` can never meaningfully hold a group. Consecutive aliases in the private acceptance fixture are split apart.

This contradicts “Label-grouped vertical flow diagram” in `README.md:22` and `docs/ROADMAP.md:20`.

Required disposition: group consecutive label declarations until the first executable/non-label block, with navigation tests for every alias.

#### FC-09 — Project JSON is excluded by the file picker (P2)

The roadmap says project JSON can be imported through Import Files (`docs/ROADMAP.md:53`), and the handler recognizes `.batflow.json` (`public/app.js:525`). The input’s `accept` list is only `.bat,.cmd,.sys,.txt` (`public/index.html:17`), so the normal picker filters out the claimed project format.

Required disposition: add the project extension/MIME type and test import through the browser UI, not only by calling the handler.

#### FC-10 — File-type behavior is misleading (P2)

The picker accepts `.cmd`, `.sys`, and `.txt`, but every selected file is opened through `parseBatch()` when clicked (`public/app.js:263-268`). `.cmd` is not the stated MS-DOS 7.1 BAT profile, CONFIG.SYS has a separate limited parser but is still rendered as batch source, and arbitrary text is presented in the batch editor. The export action remains labeled “Export current BAT” even when CONFIG.SYS is selected.

Required disposition: define supported editable/import-only file types, select the correct parser/view per type, and label export actions using the actual selected type.

#### FC-11 — Empty/new project can show stale UI (P2)

When no current file exists, `render()` updates only the file list and diagram message, then returns (`public/app.js:263-266`). It does not clear source, inspector, validation, labels, trace view, roadmap view, status, or current tab. Creating a new project while Source or Trace is active can therefore leave old project content visible.

Required disposition: render an explicit empty state for every panel and reset selection, trace result, simulation state, and appropriate view state.

#### FC-12 — Failures are silent or unhandled (P2)

Example-file fetches assume success and do not check response status (`public/app.js:526`). Storage calls are generally not caught. Roadmap failure becomes a generic unavailable message with no cause. Invalid JSON is the only import failure that gets direct feedback, and shape errors after parsing are not caught.

Required disposition: centralize recoverable error reporting, retain the previous good state on failure, and make retry/export actions available.

#### FC-13 — Phantom trailing line (P3)

`parseBatch()` splits text on newline and creates a block for the final empty element (`public/app.js:59-67`). A private fixture with a terminal newline is reported as having one additional block/line. Editing or deleting that phantom block can also alter whether the file ends with a newline.

Required disposition: define line-count semantics and terminal-newline preservation separately.

### Code quality, testing, and accessibility

#### QA-01 — DOM-coupled monolith (P1)

Nearly all parsing, validation, project resolution, simulation, persistence, rendering, and event wiring lives in one 545-line/39.5 KB `public/app.js` global script. Core functions read global `state` and DOM state, making deterministic unit testing and safe reuse difficult. Rendering and state mutation are interleaved.

Required disposition: extract pure parser, resolver, validator, simulator, and project-format modules. Keep browser persistence and rendering as adapters. This is a testability change, not a request for a framework rewrite.

#### QA-02 — Keyboard and semantic accessibility gaps (P2)

Project files are clickable `<div>` elements and diagram blocks are clickable `<article>` elements without keyboard behavior, roles, or focusability (`public/app.js:271-282`, `319`). Dynamically generated labels are usually not associated with fields by `for`/`id`. Tabs have no tablist/tab/tabpanel semantics, selected file/block state is primarily visual, status is not live-announced, and hover styles are more complete than focus styles.

Required disposition: use native interactive elements where possible, implement tab semantics/focus order, associate labels with inputs, and add keyboard/browser accessibility tests.

#### QA-03 — Responsive layout removes functionality (P2)

At widths below 1,100 px, CSS hides the entire right sidebar (`public/styles.css:76`), which contains the only block source editor, manual-note editor, duplicate/delete actions, and validation panel. The remaining grid still has a 480 px minimum editor plus 220 px sidebar, so smaller screens overflow rather than provide an alternative layout.

Required disposition: move the inspector into an accessible drawer/tab at narrower widths and test the core workflow at supported viewport sizes.

#### QA-04 — No diagnostic state (P2)

There is no structured logging, error boundary, last-save indicator, storage health indicator, schema/version display, or debug export. Failures often become stale UI or empty state.

Required disposition: expose concise operational state to users and retain actionable details for debugging without collecting user batch contents remotely.

#### QA-05 — No enforced source quality (P3)

There is no formatter, linter, HTML validator, CSS linter, Markdown checker, or link checker. `public/app.js` contains many dense one-line functions and very long lines, which increases review difficulty and hides control-flow mistakes.

Required disposition: adopt a small checked-in configuration and make formatting/static checks mandatory in CI.

### Documentation accuracy

#### DOC-01 — Claims contradict code and later docs (P1)

In addition to RM-09:

- `README.md:37-38` says external outcome inputs and CONFIG.SYS parsing do not exist; lines 43-47 say they do.
- `README.md:39` says called-file tab resolution is future; lines 49-58 say it exists.
- `README.md:21` and the button label imply one sample file; the handler silently loads and overwrites two.
- `docs/ROADMAP.md:12` claims lossless raw fallback while current import/edit/export normalizes text.
- `docs/ROADMAP.md:31` and `165` claim an in-app roadmap that returns 404.
- “verified” and “regression recovery” are unsupported by tests or history.

Required disposition: documentation must describe the current release, not preserve every development conversation in place. Move historical release facts to a changelog.

#### DOC-02 — Broken run and file references (P1)

`README.md:13` points to a URL that does not host the app. `README.md:17` says `ROADMAP.md`, but the repository file is `docs/ROADMAP.md`. No correct local command is given for serving `public/` while also making the roadmap available.

Required disposition: make every documented command and link an automated documentation/smoke test target.

#### DOC-03 — Missing durable technical documentation (P2)

The repository lacks:

- architecture and module boundaries;
- exact supported COMMAND.COM grammar and known simulation approximations;
- project JSON schema and compatibility guarantees;
- IndexedDB layout and migration rules;
- `passes` migration notes;
- browser support;
- local development/test commands;
- deployment and rollback;
- version/release policy;
- data-loss and encoding limitations;
- contributor definition of done.

Required disposition: add concise, version-controlled docs and keep behavioral detail next to executable tests.

## Positive observations worth preserving

The rehabilitation should preserve these good properties:

- The runtime is static and client-side; simulation does not execute imported commands.
- There are no third-party runtime dependencies or remote calls.
- Imported source is escaped before most HTML insertion paths.
- The private test inputs have appropriate DOS/CRLF formatting and remain
  available locally without entering Git.
- `public/app.js` passes the JavaScript syntax check in the available Node runtime.
- The product boundary is narrower and clearer than the implementation history.
- The roadmap already names several valuable acceptance scenarios; they need to become tests.

## Required version structure

### Product version

Use SemVer and record the current owner-declared version as `0.5.0` in one canonical machine-readable file. Generate, validate, or read other version displays from that source; do not manually duplicate values.

Release rules:

- Patch (`0.5.1`): compatible bug, documentation, CI, or safety fixes.
- Minor (`0.6.0`): compatible new user-facing capability.
- Major (`1.0.0`): the explicit V1 stability/compatibility commitment, not merely completion of a “Pass.”
- Pre-release (`0.6.0-beta.1`): testable artifacts not yet promoted.

If `0.5.0` is already public, the initial source import and annotated `v0.5.0` tag must point to the exact distributed source/artifact, or explicitly document any inability to reconstruct it. All assessment fixes then belong in `0.5.1`. Never reuse or move a published tag.

### Project format version

Export a document envelope along these lines:

    {
      "formatVersion": 1,
      "createdBy": {
        "product": "BATFlow",
        "productVersion": "0.5.0"
      },
      "project": {
        "id": "...",
        "name": "...",
        "files": {},
        "metadata": {}
      }
    }

`formatVersion` is not SemVer unless there is a demonstrated need for it. Increment it only when readers need migration logic. Validate the full envelope before replacing current state.

### IndexedDB schema version

Use a stable database name such as `batflow`, a documented store layout, and the numeric IndexedDB version solely for database migrations. Test upgrades from every supported schema and from verified legacy `passes` fixtures. Do not encode the schema version into a changing database name.

### Interpreter profile version

Name the behavior profile explicitly, for example `msdos-7.1-command.com`, and document which syntax and control-flow effects are modeled. This is compatibility metadata, not the BATFlow product version.

## Minimum CI design

CI should run on every pull request and every push to the protected default branch. It should use least-privilege permissions, cancel superseded runs, use a pinned Node toolchain, install from the committed lockfile, and pin reusable actions to immutable revisions.

### Static job

Run:

1. formatting check for JavaScript, HTML, CSS, Markdown, JSON, and YAML;
2. JavaScript lint;
3. HTML and CSS validation;
4. Markdown lint and internal-link check;
5. a repository policy check that canonical version, changelog heading, and release tag agree;
6. a packaging check that the staged web root contains all referenced assets and no `.git`, `.agent`, source-only docs, or secrets.

### Unit job

Extract and test pure modules. At minimum, cover:

- every supported block kind with ordinary and `@`-prefixed forms;
- CRLF/LF input and terminal newline behavior;
- consecutive labels and duplicate labels;
- quoted/unquoted IF, GOTO, CALL, direct BAT, COPY/ECHO/REN arguments;
- case-insensitive and relative target resolution without wrong-directory fallback;
- CONFIG.SYS menu/default parsing;
- synthetic outcome-producing command classifications;
- variables, paths, ERRORLEVEL, dynamic GOTO, terminal labels, short loops, and long loops;
- project schema acceptance/rejection and migrations;
- durable note/outcome identity after every structural edit;
- `passes` compatibility fixtures once the old format is known.

### Browser acceptance job

Serve only the staged release artifact and run the supported browser matrix. The first acceptance set should prove:

1. `/` opens BATFlow and all assets return 200.
2. Repository-private paths return 404.
3. A fresh project renders a complete empty state.
4. Synthetic BAT and CONFIG.SYS fixtures import through the browser UI.
5. Simulation inputs, label groups, validation, trace, and Roadmap all populate.
6. Choice outcome 1 and 2 take the expected branches.
7. Editing source invalidates or recalculates the trace.
8. File switching cannot leave a navigable trace from another file.
9. One CALL link and one direct transfer resolve and navigate correctly.
10. Project export/import round-trips through the actual file picker.
11. Reload restores a successfully saved project.
12. New Project, Load Example, and colliding imports cannot discard data without an explicit decision.
13. Keyboard-only users can import, select, edit, inspect validation, and export.

### Release job

On a signed/annotated `v*` tag:

1. verify the tag equals the canonical product version;
2. rerun the complete CI suite;
3. assemble the clean static artifact;
4. run HTTP and browser smoke tests against that exact artifact;
5. generate a deterministic archive and SHA-256 checksum;
6. attach both plus changelog-derived release notes to the release;
7. retain the tested artifact for rollback.

Dependency-update automation should submit reviewed upgrades for development tools and workflow actions rather than allowing unreviewed floating versions.

## Recommended repository controls

After a remote is created:

- Use a clearly chosen default branch; renaming `master` to `main` is optional but should be decided once.
- Require pull requests and the CI checks above.
- Prevent force-pushes and tag mutation on protected release refs.
- Require at least one review for behavioral changes once another maintainer exists.
- Add ownership for parser/simulator, project format, and release workflow.
- Keep feature work separate from release/CI repair when practical.
- Use issues/milestones for future work and a changelog for completed releases.

## Remediation order

### Phase 0 — Preserve facts before changing code

1. Determine whether a `0.5.0` artifact has already been distributed.
2. Preserve the exact current/distributed files and hashes.
3. Create an honest initial import commit; do not fabricate Pass history.
4. Record the `passes` rename and known compatibility facts.
5. Establish the product, project-format, and database version sources.

Exit criterion: a reviewer can identify what `0.5.0` means and can retrieve the exact corresponding source/artifact.

### Phase 1 — Stop data loss and unsafe serving

1. Replace the repository-root deployment path with a clean staged web root.
2. Fix or remove the in-app roadmap dependency.
3. Add safe replacement/collision flows for project-destructive actions.
4. Validate project imports before state replacement.
5. Make persistence failures visible and recoverable.

Exit criterion: normal documented use cannot expose repository internals or silently discard the current project.

### Phase 2 — Lock down completed behavior

1. Extract testable parser/simulator/project modules.
2. Add tests that reproduce FC-01 through FC-07 and DI-02 through DI-05.
3. Fix the outcome-producing acceptance trace, stale traces, prefix handling, quoted paths, resolver fallback, loop reporting, and label grouping.
4. Reconcile durable identities and round-trip behavior.

Exit criterion: every P0/P1 completed-feature defect has a failing-before/passing-after test.

### Phase 3 — Establish CI and release automation

1. Add pinned development tooling, manifest, lockfile, and documented commands.
2. Add static, unit, browser, packaging, and version-consistency CI jobs.
3. Protect the default branch and release tags.
4. Add the tag-triggered deterministic release workflow.

Exit criterion: a clean checkout can produce the same tested artifact using one documented command, and release creation cannot bypass CI.

### Phase 4 — Correct documentation and governance

1. Rewrite README around the actual current release and verified commands.
2. Split changelog, current roadmap, architecture, compatibility, and operations concerns.
3. Add contributor, security, ownership, support, ignore, and owner-selected license files.
4. Display the product/profile/project-format versions where users and support can find them.

Exit criterion: documentation assertions are either exercised by CI or explicitly labeled limitations.

## Release readiness checklist

BATFlow should not be considered properly managed until all items below are true:

- [ ] Current `0.5.0` provenance is recorded without inventing history.
- [ ] The `passes` rename and migration/compatibility outcome are documented and tested.
- [ ] Product, project-format, and IndexedDB versions are distinct.
- [ ] A clean checkout has one documented install/check/package path.
- [ ] P0 and P1 findings are fixed or explicitly accepted by the owner with release notes.
- [ ] Static, unit, and supported-browser checks pass in CI.
- [ ] Synthetic BAT and CONFIG.SYS inputs are automated acceptance fixtures.
- [ ] The packaged site serves at `/` and contains no repository internals.
- [ ] Project replacement/import cannot silently lose the current saved project.
- [ ] Export/import and browser-storage migrations are schema-validated.
- [ ] The release tag, source version, changelog, artifact, and checksum agree.
- [ ] README commands and links pass automated smoke/link checks.
- [ ] A license and basic contribution/security ownership policies are present.

## Explicitly excluded future features

This assessment does not require the following to call the current completed work correctly managed and testable:

- cross-file execution expansion through CALL stacks;
- ZIP-based `.batflow` containers;
- undo/redo as a general product feature;
- drag ordering or command palette insertion;
- branch-exploration mode;
- generated labels;
- visual CONFIG.SYS editing;
- post-V1 interpreter profiles;
- GitHub integration inside the BATFlow application.

They should remain future work until the existing persistence, parser, simulator, deployment, CI, and release foundations are reliable.
