# BATFlow roadmap

Last updated: July 27, 2026

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

Status: **Release-candidate CI green; awaiting human verification**

### Completed on the release-candidate branch

- Canonical `0.5.0` product metadata, honest baseline history, rename record,
  locked Node 24 tooling, CI, and a tag-only release workflow.
- Independent product, project-format, IndexedDB-schema, and interpreter-profile
  versions.
- Validated version-1 project import/export, explicit UTF-8 and line-ending
  behavior, durable source identities, and visible storage errors.
- Non-destructive legacy recovery from known `passes` and BATFlow databases.
- Confirmation for destructive project/file replacement operations.
- Tested parser and simulator corrections for outcome handling, stale traces,
  command prefixes, quoted paths, target resolution, label grouping, loops,
  conditional transfers, and interpreter exit.
- Static analysis, unit, browser, persistence, migration, accessibility, HTTP,
  deterministic packaging, checksum, and private-path boundary checks.
- Compatibility, format, changelog, release, and human-test documentation.
- Draft pull request #1 is open and its required `verify` CI check passes.

### Remaining release gate

- Test the exact packaged archive with representative owner-supplied private
  inputs using [the human checklist](HUMAN_TESTING.md).
- Human-review and merge the pull request.
- With explicit owner authorization, create annotated tag `v0.5.0` from the
  verified merge commit. The tag workflow must publish the matching archive and
  checksum.

### 0.5.0 release gate

- No open or silently deferred P0/P1 assessment findings; the unavailable
  historical `passes` artifact is an explicit compatibility limitation.
- Canonical version, changelog, source, tag, artifact, and checksum agree.
- A clean checkout can reproduce the tested artifact.
- Private fixtures and generated test results are absent from Git history and
  the release artifact.
- README commands and links pass automated checks.
- Human verification and required CI checks are recorded for the tagged commit.

## 0.5.x hardening

After `0.5.0`, address remaining medium- and low-priority work:

- Project-scoped, durable simulation scenarios.
- Project naming and richer file identity/collision controls.
- Structured diagnostics beyond the current save/import status.
- Broader browser compatibility, asset caching, and offline behavior.
- Terminal-newline presentation cleanup and additional keyboard ergonomics.

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
