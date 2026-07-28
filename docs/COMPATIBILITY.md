# Compatibility

## Interpreter boundary

BATFlow 0.5.2 models the Win98 MS-DOS 7.1 `COMMAND.COM` profile. Simulation is
an explanatory control-flow model; it does not execute imported commands and
is not a byte-for-byte interpreter.

The 0.5.2 trace is intentionally single-file. `CALL` is recorded and returns to
the following line; direct batch invocation records a transfer and stops.
Cross-file trace expansion remains planned for 0.6.0.

## Input boundary

- Supported source imports: `.bat`, `.sys`, and `.txt`.
- Supported project import/export: UTF-8 `.batflow`, format version 2 with
  migration from version 1.
- Supported source encoding: UTF-8 with or without a byte-order mark.
- Preserved line endings: CRLF, LF, or CR. Mixed endings normalize on edit.
- Relative project paths and folder import are supported. User-entered rename
  paths require DOS 8.3 components; safe noncompliant imported paths are
  preserved with warnings.
- Unsupported: `.cmd`, binary data, guessed OEM/DOS code pages, absolute
  project paths, and parent-directory traversal.

## Storage and the former `passes` name

The current IndexedDB database has the stable name `batflow` and schema version

1. On an empty current database, BATFlow performs best-effort recovery from
   the known legacy database names `batflow-v1`, `passes`, and `passes-v1`.
   Recovered data is copied into the current versioned store; legacy databases
   are retained so migration is reversible.

No distributable historical `passes` artifact was available during
stabilization, so compatibility cannot be claimed for unknown store names,
origins, schemas, or file extensions. Browser storage is origin-scoped: moving
the app to a new origin cannot automatically access data from the old origin.
Export a project from the old deployment where possible before moving.
