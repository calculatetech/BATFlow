# Changelog

BATFlow follows Semantic Versioning for product releases. The project-format,
browser-storage, and interpreter-profile versions are managed separately.

## 0.5.0 — release candidate

This is the first release managed in Git. Earlier development used the name
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

### Fixed

- `@`-prefixed structural commands, quoted paths, qualified target resolution,
  consecutive labels, CHOICE outcomes, conditional transfers, EXIT handling,
  and step-limit reporting.
- Silent storage/import failures and stale empty-state panels.

The release remains untagged until its draft pull request passes CI and a human
completes the packaged-artifact checklist.
