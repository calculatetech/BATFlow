# BATFlow diagnostics

BATFlow 0.5.3 exposes local operational diagnostics without sending project
data anywhere. The header badge summarizes active runtime, browser-storage,
save, and diagnostic-history health. Its dialog provides local technical
details and the last successful save observed during the current tab session.

## Retention and health

At most 100 events are retained in `sessionStorage`. They survive reloads in
the current tab session and are discarded when that session ends. If
`sessionStorage` is blocked or full, diagnostics continue in memory and report
that history retention is unavailable.

Historical events do not keep health in an error state after the affected
subsystem recovers. Clearing history removes recorded events but does not clear
an active failure. Runtime and storage health are rebuilt from actual startup
results after every reload.

Local event details may contain browser error messages or project context
needed to diagnose a failure. They remain in the browser session and are never
included in the diagnostics export.

## Export format 1

`batflow-diagnostics-*.json` contains:

- product, project-format, IndexedDB-schema, diagnostics-format, and
  interpreter-profile versions;
- browser user agent, language, and online state;
- active subsystem states and the last observed successful-save time;
- file, current-validation, and event counts;
- event timestamps, severity, subsystem, stable code, and fixed safe summary.

The export intentionally excludes project names, filenames, source content,
manual notes, simulation variables, simulated paths and outcomes, raw error
messages, and stack traces. Export is a local download; BATFlow performs no
upload or remote telemetry.

Diagnostics format versioning is independent from the BATFlow product,
`.batflow` project, IndexedDB schema, and interpreter-profile versions.
