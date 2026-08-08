# Changelog

## 0.6.0 — focused rebuild

- Replaced the project-oriented editor with a memory-only, static application.
- Added a multi-file MS-DOS 7.1 parser and complete 2D control-flow graph.
- Added CONFIG.SYS menus, COMMON/INCLUDE expansion, AUTOEXEC handoff, calls,
  transfers, returns, loops, decisions, and dynamic jumps.
- Moved simulation inputs into their relevant blocks and added exact executed
  source output.
- Added a dark Breeze-inspired shell, pan/zoom, basic source highlighting,
  Firefox and Chromium acceptance, accessibility checks, a Firefox snapshot,
  static-host smoke tests, and a 2,000-line performance budget.
- Removed persistence, project containers, block editing, diagnostics history,
  packaging, and offline-oriented machinery.

## 0.5.0–0.5.3

The earlier managed prototype added project persistence, editing, simulation,
and diagnostics. Version 0.6.0 intentionally replaces that architecture; its
history remains available in Git.
