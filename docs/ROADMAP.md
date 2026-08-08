# BATFlow 0.6.0 rebuild roadmap

BATFlow is being rebuilt as a static, client-side MS-DOS 7.1 flow visualizer.
Each task has one outcome, lands through a pull request into `rebuild/0.6.0`,
and must pass the required `verify` check before merge.

| Task   | Outcome                                                                     | Status      | Pull request |
| ------ | --------------------------------------------------------------------------- | ----------- | ------------ |
| BF-001 | Lock the rebuild contract and delivery rules.                               | In progress | —            |
| BF-002 | Replace the application with a memory-only source session and Breeze shell. | Planned     | —            |
| BF-003 | Build the batch parser and control-flow graph.                              | Planned     | —            |
| BF-004 | Link CONFIG.SYS, AUTOEXEC.BAT, and reachable batch files.                   | Planned     | —            |
| BF-005 | Render the complete program as a pannable, zoomable 2D graph.               | Planned     | —            |
| BF-006 | Select active paths with in-block inputs and show executed code.            | Planned     | —            |
| BF-007 | Enforce browser, accessibility, visual, and performance acceptance.         | Planned     | —            |
| BF-008 | Cut over the reviewed 0.6.0 application to `main`.                          | Planned     | —            |

## Product boundary

- Load UTF-8 BAT and CONFIG.SYS sources into one in-memory session.
- Visualize every possible branch before simulation; simulation selects and
  emphasizes a path without changing graph topology.
- Model MS-DOS 7.1 `COMMAND.COM` flow and complete multiple-configuration boot
  menus, but never execute imported commands.
- Deploy the contents of `public/` directly on an ordinary static web server.
- Support current desktop Firefox first and Chromium second.
- Keep inputs in the graph block that produces or consumes them.

BATFlow is not an IDE, project database, version-control system, diff tool,
backend service, or offline application. It has no named projects, browser
persistence, service worker, edit history, block editor, or project container.

## Delivery rules

- One task ID and one user-visible or architectural outcome per pull request.
- Update this table in the task pull request; completed work does not remain in
  a narrative backlog.
- Run unit, Firefox, Chromium, accessibility, performance, and static-host
  checks before merge.
- Include screenshots for visual changes and performance deltas for parser,
  layout, renderer, or simulator changes.
- Resolve every review thread before merge. The final integration pull request
  targets `main` only after BF-001 through BF-008 are complete.
