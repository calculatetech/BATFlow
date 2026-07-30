# BATFlow human change verification

Complete the relevant parts of this checklist against the uncommitted
implementation worktree before it is committed. A commit is authorized only
after the project owner approves that working tree. If behavior changes
afterward, human verification must be repeated before another commit.

Firefox is the required browser for human verification. Chromium and WebKit
are required automated CI engines; CI artifacts are never the human test
target.

After approval, commit and push the exact reviewed tree. Required CI then
confirms that the committed source reproduces the automated checks and
deployment bundle. Before merge, inspect all pull-request comments and review
threads, address every actionable finding, and resolve every thread. Keep
screenshots and detailed logs outside Git.

## Adversarial review gate

Code changes and major rework require independent, read-only adversarial review
before the candidate is handed to the project owner. Each reported issue must
be reproduced or otherwise evidenced, challenged for material impact on the
accepted scope, and rejected when it would create speculative or unrelated
work. Corrective code changes reset this gate and require focused re-review.
Review assignments are single-use: completed reviewer agents are closed and
must never be reactivated for another pass. Exactly one reviewer assignment may
be active at a time, and that reviewer is scoped to the complete candidate
change rather than a partial review domain.

Simple documentation and progress-only updates are exempt. Review notes and
probe output belong under ignored `.agent/test-results/`, not in commits.

## Required checks

- Serve `public/` from the implementation worktree and confirm the displayed
  development version matches the version under review.
- Refresh without clearing browser data and confirm the development identifier
  advances and saved work remains available.
- Import representative UTF-8 BAT and CONFIG.SYS files, including the owner's
  private fixtures; confirm those files are not present in the deployment
  bundle.
- Exercise both sides of CHOICE/ERRORLEVEL and path-existence branches.
- Change simulation variables, paths, and outcomes; switch files and reload
  after Saved, then confirm the values remain project-scoped and intact.
- Export and reimport the project; confirm simulation inputs round-trip. Reset
  inputs, approve the confirmation, and confirm stored values clear while a
  CONFIG.SYS default may be derived again.
- Edit, insert, duplicate, and delete source lines; confirm the diagram and
  trace update immediately and notes stay on the intended command.
- Reload after the visible `Saved` state and confirm work persists.
- Cancel New Project and a same-name file replacement; confirm current work
  remains. Then approve each operation and confirm it behaves as described.
- Name a project, reload after Saved, and confirm the name and `.batflow`
  download filename persist. Confirm New Project can be canceled before any
  state changes.
- Import a nested source folder once with its selected root stripped and once
  with it retained. Confirm unsupported files are summarized and skipped.
- Exercise Replace, Keep both, Skip, and cancel for case-insensitive and
  separator-equivalent collisions. Confirm cancel leaves the complete project
  untouched.
- Import a safe non-8.3 path and confirm it remains unchanged with a visible
  warning. Confirm manually entered rename paths enforce DOS 8.3 components.
- Rename a file into a relative directory and confirm notes, simulation
  outcomes, and entry designation remain attached. Replace it and confirm
  source-attached state clears. Delete the entry and confirm fallback prefers
  root AUTOEXEC.BAT.
- Export the `.batflow` project, create a new project, reimport the export, and
  compare source, notes, file list, and line endings.
- Confirm an invalid or future-version project reports an error without
  replacing current work.
- Open Diagnostics and confirm it reports product 0.5.4, shell revision
  0.5.4-dev.17, project format 2, IndexedDB schema 1, diagnostics format 2, and
  the current interpreter profile.
- Edit source and confirm Diagnostics transitions through Saving to Healthy,
  records the successful-save time, and retains session events after reload.
- Force or otherwise observe a save/storage failure and confirm the health
  badge remains Error even if another transient message appears. After a
  successful save, confirm health recovers while the failure remains in
  history.
- Export diagnostics and confirm it contains operational codes, versions, and
  counts but no project name, filenames, source, notes, or simulation values.
  Clear history and confirm an active failure remains visible.
- On the first Firefox load for an origin, respond to any browser-native
  persistent-storage prompt. Reload and confirm it is not requested again.
  Confirm Diagnostics reports Persistent or Best effort without treating
  denial as an application error.
- Wait for Diagnostics to report the offline application shell Ready. Put
  Firefox offline without clearing browser data, reload, and confirm the full
  editor and saved project open normally with only the compact Offline chip.
  Edit and save while offline, reconnect, reload, and confirm the edit remains.
- Load the previous candidate at a local origin, then serve the new candidate
  from the same origin. Confirm Update ready appears without an automatic
  reload. Activate it and confirm the project first reaches Saved, the page
  reloads once, and the new shell revision is reported. A forced save failure
  must leave the old page open and the action available.
- Refresh online without clearing browser data and confirm current HTML and
  the managed shell revision load without stale or mixed runtime assets.
- Navigate file items, tabs, labels, blocks, validation findings, and inspector
  controls using only the keyboard at desktop and narrow viewport widths.
- Confirm the repository, `.git`, `.agent`, `docs`, tests, private fixtures, and
  test-result files are not available from the staged web root.

## Approval boundary

After the owner approves the working tree, commit and push that exact tree.
Merge only after required CI passes and all pull-request comments and review
threads are addressed and resolved. Do not create formal Git tags or GitHub
releases before `1.0.0`.
