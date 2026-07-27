# BATFlow

BATFlow is a static, client-side visual editor and control-flow simulator for
Win98 MS-DOS 7.1 batch files.

The project is currently stabilizing its first managed release, `0.5.0`.
BATFlow was formerly called `passes`.

## Run locally

From the repository root:

```sh
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`.

Only `public/` is a deployable web root. Do not serve the repository root.

## Current capabilities

- Browser-local IndexedDB project persistence
- Multi-file BAT, CONFIG.SYS, and text import
- Label-oriented flow diagrams and source/split views
- Blocks for conditions, jumps, calls, variables, pipelines, comments,
  interpreter commands, and external commands
- Basic Win98 syntax validation
- Variable, path-existence, and flow-relevant ERRORLEVEL simulation inputs
- Single-file control-flow traces with dynamic GOTO support
- Block editing, duplication, deletion, and manual notes
- JSON project export and individual file export

The current implementation is a prototype and is not yet a lossless editor.
Review the [roadmap](docs/ROADMAP.md) for release status and the
[project assessment](docs/PROJECT_ASSESSMENT.md) for detailed findings.

## Development policy

All changes are developed in branches or worktrees. Nothing is merged until
the relevant CI checks pass and a human verifies the result.

Private test inputs belong in the ignored `docs/private/` directory. Tracked
tests use deliberately synthetic fixtures under `tests/fixtures/synthetic/`.
Detailed local test output belongs in the ignored `.agent/test-results/`
directory and must not be committed.
