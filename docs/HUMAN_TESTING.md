# BATFlow human change verification

Complete the relevant parts of this checklist against the uncommitted
implementation worktree before it is committed. A commit is authorized only
after the project owner approves that working tree. If behavior changes
afterward, human verification must be repeated before another commit.

After approval, commit and push the exact reviewed tree. Required CI then
confirms that the committed source reproduces the automated checks and
deployment bundle. Keep screenshots and detailed logs outside Git.

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
- Export the `.batflow` project, create a new project, reimport the export, and
  compare source, notes, file list, and line endings.
- Confirm an invalid or future-version project reports an error without
  replacing current work.
- Navigate file items, tabs, labels, blocks, validation findings, and inspector
  controls using only the keyboard at desktop and narrow viewport widths.
- Confirm the repository, `.git`, `.agent`, `docs`, tests, private fixtures, and
  test-result files are not available from the staged web root.

## Approval boundary

After the owner approves the working tree, commit and push that exact tree.
Merge only after required CI passes. Do not create formal Git tags or GitHub
releases before `1.0.0`.
