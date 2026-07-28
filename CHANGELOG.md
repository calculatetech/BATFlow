# Changelog

BATFlow uses Semantic Versioning for managed development milestones. Formal Git
tags and GitHub releases begin at `1.0.0`. The project-format, browser-storage,
and interpreter-profile versions are managed separately.

## 0.5.2 — project and file identity hardening

### Added

- Editable project names and durable, user-selectable entry files.
- Relative-folder import with explicit root placement and a complete preview
  before mutation.
- File rename and deletion controls, DOS 8.3 path diagnostics, and
  case-insensitive Replace, Keep both, or Skip collision choices.

### Changed

- `.batflow` project format 2 keys notes, line identities, and outcomes through
  durable file IDs. Version 1 projects migrate on load or import.
- Replacing a project file retains its identity and entry designation while
  clearing source-attached notes, line identities, and outcomes.
- Unsupported files in a folder selection are skipped with a visible summary.

### Fixed

- File renames no longer detach notes, outcomes, or entry-file state.
- Case or separator variants can no longer create ambiguous duplicate DOS
  paths.
- Imported non-8.3 names remain unchanged and are reported as warnings instead
  of being silently renamed.

## 0.5.1 — simulation-state hardening

### Added

- One validated, project-scoped active simulation scenario.
- Durable variable, path-existence, and ERRORLEVEL inputs across file switches,
  browser reloads, storage, and `.batflow` export/import.
- A confirmed Reset inputs action for clearing the project scenario.

### Changed

- Simulation input edits now participate in the visible autosave lifecycle.
- CONFIG.SYS defaults remain derived until the user interacts with simulation
  inputs. Explicitly clearing `%config%` suppresses `MENUDEFAULT`; Reset inputs
  restores derivation.

### Fixed

- Stored ERRORLEVEL outcomes are scoped to the producing command and project
  file instead of following unrelated replacement lines or colliding across
  files.
- Invalid ERRORLEVEL inputs report a visible validation error without leaving a
  stale trace, are constrained to the DOS `0`–`255` range, and show the
  greater-than-or-equal comparison in execution traces.
- Dynamic GOTO traces distinguish missing simulation input from COMMAND.COM
  termination caused by an empty or nonexistent label.
- Projects containing outcomes accepted before that range was enforced recover
  by clearing only those invalid outcomes instead of failing the entire load.
- Hostile but valid DOS map keys survive project round-trips.
- A completed older save can no longer report `Saved` while newer changes are
  still waiting to be persisted.

## 0.5.0 — development baseline

This is the first version managed in Git. Earlier development used the name
`passes` and informal pass numbers; that history predates repository
provenance and has not been fabricated as commits.

### Added

- Versioned JSON project format with validated legacy import.
- Stable IndexedDB storage and best-effort recovery from known BATFlow and
  `passes` database names.
- Durable source-line identities for notes and navigation.
- Unit, browser, persistence, migration, accessibility, packaging, and HTTP
  checks.
- Deterministic release archive and SHA-256 checksum generation.

### Changed

- Parser and simulator logic now live in testable browser/Node modules.
- Trace results recalculate after source and file changes.
- UTF-8 and line-ending behavior is explicit and validated.
- New Project, project replacement, and filename collision operations require
  confirmation when they would overwrite work.
- Project files use the canonical `.batflow` extension.

### Fixed

- `@`-prefixed structural commands, quoted paths, qualified target resolution,
  consecutive labels, CHOICE outcomes, conditional transfers, EXIT handling,
  and step-limit reporting.
- Silent storage/import failures and stale empty-state panels.
- CONFIG.SYS menu generation/default evaluation, Split-view source selection,
  blank-line diagram clutter, browser cache revisioning, and project download
  filenames.

The approved baseline was merged after human verification and successful CI.
It is intentionally untagged and unpublished while pre-1.0 development
continues.
