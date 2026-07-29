# Compatibility

## Interpreter boundary

BATFlow 0.5.4 models the Win98 MS-DOS 7.1 `COMMAND.COM` profile. Simulation is
an explanatory control-flow model; it does not execute imported commands and
is not a byte-for-byte interpreter.

The 0.5.4 trace is intentionally single-file. `CALL` is recorded and returns to
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

## Browser boundary

The required automated browser matrix is the Firefox, Chromium, and WebKit
engines locked by Playwright 1.62. Firefox is also the required browser for
human change verification. Engine automation is the exact compatibility
evidence; it is not a claim that every older, mobile, embedded, or branded
browser behaves identically.

IndexedDB is the project store in all supported engines. Persistent-storage
policy differs by browser: Firefox may display a native permission prompt,
while other engines may grant or deny the request without one. Denial is a
supported best-effort state rather than an application failure. Private
browsing and browser data clearing may discard both projects and offline
caches.

## Offline and upgrade boundary

On HTTPS or localhost, the application shell is cached after one successful
online load. A controlled page can then reload, edit, and save projects while
offline. This is not an installable PWA and does not include a web app manifest.

Project content remains in IndexedDB and is never copied into the application
shell cache. A waiting shell update is visible but never reloads the editor
automatically. Activation requires a successful immediate project save.

The browser may evict best-effort origin storage. BATFlow requests persistent
storage once when supported, but cannot guarantee that it will be granted.
Exported `.batflow` files remain the durable backup and transfer mechanism.
