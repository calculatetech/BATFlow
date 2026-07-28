# BATFlow roadmap

Last updated: July 28, 2026

Current baseline: **0.5.1 development**

BATFlow, formerly called `passes`, is being converted from an unversioned
prototype into a managed and genuinely usable application. The detailed audit
is preserved in the [project assessment](PROJECT_ASSESSMENT.md); this roadmap
is the human-facing record of completed foundations and remaining priorities.

## Product boundary

- BATFlow is a static, entirely client-side application.
- Win98 MS-DOS 7.1 `COMMAND.COM` is the initial interpreter profile.
- Simulation follows modeled control flow but never executes imported commands.
- Projects persist in browser-owned storage and can be exported.
- BAT and CONFIG.SYS inputs are user-supplied; private test inputs are never
  shipped with the application.
- The roadmap is repository documentation, not an in-application feature.

## Delivery and version policy

- All work is performed in a branch or dedicated worktree.
- The project owner verifies the uncommitted working tree before it is
  committed.
- After approval, the exact reviewed tree is committed and pushed. It reaches
  `main` only after required CI succeeds and the pull request is merged.
- CI-generated bundles validate packaging and reproducibility; they are not
  substitutes for human testing.
- Private fixtures live under ignored `docs/private/`. Detailed local results
  live under ignored `.agent/test-results/`; neither is committed.
- Roadmap status changes accompany the work they describe.
- Managed development advances through SemVer-compatible `0.x` versions.
  Formal Git tags and GitHub releases begin at `1.0.0`.
- Project-format, IndexedDB-schema, and interpreter-profile versions remain
  independent from the product version.

## Completed: managed 0.5.0 foundation

Status: **Human-approved, CI-verified, and merged in pull request #1**

- Established honest Git provenance, canonical product metadata, a locked Node
  24 toolchain, required CI, and deterministic deployment-bundle validation.
- Separated product, project-format, IndexedDB-schema, and interpreter-profile
  versions.
- Added validated project import/export, explicit UTF-8 and line-ending
  behavior, durable source identities, visible storage failures, and
  non-destructive recovery from known legacy database names.
- Added confirmation for destructive project and file replacement operations.
- Corrected outcome handling, stale traces, command prefixes, quoted paths,
  target resolution, label grouping, loops, conditional transfers, interpreter
  exit, CONFIG.SYS choices, Split-view selection, blank blocks, caching, and
  `.batflow` downloads.
- Added static, unit, browser, persistence, migration, accessibility, HTTP,
  packaging, checksum, reproducibility, and private-path boundary checks.
- Recorded the compatibility boundary, project format, baseline assessment,
  changelog, and human-verification process.

This foundation makes changes manageable and testable. It is not a declaration
that BATFlow is stable, complete, or ready for formal release.

## Completed: 0.5.1 simulation-state hardening

- Added one validated, project-scoped active simulation scenario.
- Persisted variable, path-existence, and ERRORLEVEL inputs across file
  switches, browser reloads, storage, and `.batflow` export/import.
- Added a confirmed project-wide Reset inputs action.
- Preserved CONFIG.SYS-derived defaults without storing them until simulation
  input interaction.

## Priority 1: 0.5.x usability hardening

- Project naming and richer file identity and collision controls.
- Structured diagnostics beyond the current save and import status.
- Broader browser compatibility, cache behavior, and offline behavior.
- Terminal-newline presentation cleanup and additional keyboard ergonomics.

Compatible fixes and hardening advance the patch version. The exact target is
set when each implementation scope is accepted.

## Priority 2: 0.6.x and later capabilities

- Cross-file CALL and direct-transfer execution traces.
- ZIP-based `.batflow` containers with nested paths.
- Undo/redo, generated-source diff, and durable edit history.
- Saved scenarios, assertions, and branch exploration.
- Explicit label operations, drag ordering, and command insertion.
- Limited visual CONFIG.SYS editing and additional verified interpreter
  features.

New user-facing capability milestones advance the minor version.

## Toward 1.0.0

`1.0.0` is the first formally tagged and published release. It represents a
deliberate compatibility and data-fidelity commitment, including stable
project/storage migrations, documented interpreter behavior, lossless
supported-file handling, sustained CI, and successful human verification of a
usable application.
