# BATFlow roadmap

Last updated: July 26, 2026

Current target: **stable 0.5.0**

BATFlow, formerly called `passes`, is being converted from an unversioned
prototype into a managed, tested release. The detailed audit is preserved in
the [project assessment](PROJECT_ASSESSMENT.md); this roadmap is the
human-facing record of completed foundations and remaining priorities.

## Product boundary

- BATFlow is a static, entirely client-side application.
- Win98 MS-DOS 7.1 `COMMAND.COM` is the initial interpreter profile.
- Simulation follows modeled control flow but never executes imported commands.
- Projects persist in browser-owned storage and can be exported.
- BAT and CONFIG.SYS inputs are user-supplied; private test inputs are never
  shipped with the application.
- The roadmap is repository documentation, not an in-application feature.

## Delivery policy

- All work is performed in a branch or dedicated worktree.
- No change reaches `main` until CI succeeds and a human verifies it.
- The empty repository is bootstrapped once from a CI-verified branch; after
  that promotion, all changes use reviewed pull requests.
- Test code and clearly synthetic fixtures are tracked. Private fixtures live
  under ignored `docs/private/`.
- Detailed local test output lives under ignored `.agent/test-results/`.
  Generated results never receive follow-up commits.
- Roadmap status changes are included with the behavioral change they describe.
- Release tags are immutable and identify the exact human-verified, CI-green
  commit.

## Completed foundation

The prototype currently provides:

- A static browser application with local project persistence.
- Multi-file import and individual file/project export.
- Diagram, source, split, and execution-trace views.
- Parsing and visualization for labels, conditions, jumps, calls, variables,
  pipelines, comments, known commands, and external commands.
- Basic COMMAND.COM syntax validation and CONFIG.SYS menu awareness.
- Simulation inputs for variables, paths, and selected ERRORLEVEL outcomes.
- Single-file trace navigation, label navigation, and called-file links.
- Block source editing, duplication, deletion, notes, and REN/RENAME inspection.

These capabilities establish product direction but are not all release-verified.
The `0.5.0` milestone closes the release-blocking and high-priority gaps.

## Milestone: stable 0.5.0

Status: **In progress**

### 1. Establish the managed project

- Preserve an honest initial source baseline without fabricating prior history.
- Record `0.5.0` as the canonical product version and document the rename from
  `passes`.
- Separate product, exported-project, IndexedDB schema, and interpreter-profile
  versions.
- Add reproducible development commands, locked tooling, CI, release packaging,
  and immutable release metadata.
- Publish only a staged web root and verify that repository-private paths are
  unavailable.

### 2. Make projects safe

- Prevent New Project, imports, and filename collisions from silently replacing
  saved work.
- Validate and version project imports before changing current state.
- Reconcile durable block identities so notes, outcomes, and navigation survive
  structural source edits.
- Define and test encoding and line-ending behavior.
- Make IndexedDB failures visible, recoverable, and upgrade-safe.

### 3. Stabilize parsing and simulation

- Model flow-relevant outcome producers consistently.
- Recalculate or invalidate traces after source and file changes.
- Correct command-prefix, quoted-path, target-resolution, and label-grouping
  behavior.
- Distinguish completed traces from step limits and probable loops.
- Model conditional transfers and termination as control flow.
- Preserve supported single-file behavior while adding regression coverage.

### 4. Verify and release

- Turn all release-blocking and high-priority assessment findings into
  reproducible tests and close them by a tested fix, removal of unintended
  behavior, or explicit owner acceptance.
- Run static, unit, browser, persistence, migration, packaging, and accessibility
  checks in CI.
- Verify a release candidate manually from the exact packaged artifact.
- Create annotated tag `v0.5.0` only after the full CI suite passes and a human
  approves that exact commit.

### 0.5.0 release gate

- No open or silently deferred P0/P1 assessment findings.
- Canonical version, changelog, source, tag, artifact, and checksum agree.
- A clean checkout can reproduce the tested artifact.
- Private fixtures and generated test results are absent from Git history and
  the release artifact.
- README commands and links pass automated checks.
- Human verification and required CI checks are recorded for the tagged commit.

## 0.5.x hardening

After `0.5.0`, address the remaining medium- and low-priority assessment work:

- Project-scoped simulation scenarios and improved autosave behavior.
- Clearer file-type, project-name, collision, and empty-state behavior.
- Keyboard accessibility and responsive inspector access.
- Structured diagnostics and user-visible save/error status.
- Browser compatibility, asset caching, formatting, linting, and documentation
  enforcement.

## 0.6.0 and later

Once the managed foundation is stable, resume product expansion:

- Cross-file CALL and direct-transfer execution traces.
- ZIP-based `.batflow` import/export with nested paths.
- Undo/redo, generated-source diff, and durable edit history.
- Saved scenarios, assertions, and branch exploration.
- Explicit label operations, drag ordering, and command insertion.
- Limited visual CONFIG.SYS editing and additional verified interpreter features.

## Toward 1.0.0

`1.0.0` represents a deliberate compatibility and data-fidelity commitment,
not completion of an internal pass number. It requires stable project/storage
migrations, documented interpreter behavior, lossless supported-file handling,
and a sustained CI/release process.
