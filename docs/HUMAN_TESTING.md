# BATFlow 0.5.0 human release verification

Complete this checklist from the exact `batflow-0.5.0.zip` attached to the
draft pull request's green commit. Do not test a working-tree copy.

Record the commit SHA, archive SHA-256, browser/OS, and result in the pull
request. Keep screenshots and detailed logs outside Git.

## Required checks

- Confirm the archive checksum matches `batflow-0.5.0.zip.sha256`.
- Extract the archive and serve that directory as the web root.
- Confirm the UI displays `v0.5.0` and starts with a clean empty state in a
  private browser profile.
- Import representative UTF-8 BAT and CONFIG.SYS files, including the owner's
  private fixtures; confirm those files are not present in the archive.
- Exercise both sides of CHOICE/ERRORLEVEL and path-existence branches.
- Edit, insert, duplicate, and delete source lines; confirm the diagram and
  trace update immediately and notes stay on the intended command.
- Reload after the visible `Saved` state and confirm work persists.
- Cancel New Project and a same-name file replacement; confirm current work
  remains. Then approve each operation and confirm it behaves as described.
- Export the project, create a new project, reimport the export, and compare
  source, notes, file list, and line endings.
- Confirm an invalid or future-version project reports an error without
  replacing current work.
- Navigate file items, tabs, labels, blocks, validation findings, and inspector
  controls using only the keyboard at desktop and narrow viewport widths.
- Confirm the repository, `.git`, `.agent`, `docs`, tests, private fixtures, and
  test-result files are not available from the staged web root.

## Approval boundary

After all checks pass and required CI is green, approve and merge the pull
request. Create annotated tag `v0.5.0` from that exact merge commit only with
the owner's explicit release authorization. The tag workflow re-verifies and
publishes the immutable archive and checksum.
