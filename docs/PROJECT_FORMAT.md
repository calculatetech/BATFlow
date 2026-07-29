# BATFlow project format

BATFlow 0.5.4 exports UTF-8 JSON files named `*.batflow`. The top-level
envelope keeps independent version domains:

```json
{
  "formatVersion": 2,
  "createdBy": {
    "product": "BATFlow",
    "productVersion": "0.5.4"
  },
  "interpreterProfile": "msdos-7.1-command.com",
  "project": {}
}
```

`formatVersion` governs import compatibility. It is not the BATFlow product
version or IndexedDB schema version.

## Version 2 project identity

Each project has an opaque project ID, editable name, file map, and metadata.
File-map keys are user-visible relative paths. Paths are compared
case-insensitively with slash and backslash treated equivalently, but BATFlow
preserves the imported or user-entered spelling.

Every file record has its own opaque `id`, UTF-8 content, preferred `CRLF`,
`LF`, or `CR` line ending, and normalization metadata. File IDs are unique and
remain stable through rename and explicit replacement.

Metadata uses file IDs rather than paths:

- `entryFileId` identifies the file opened with the project.
- `entryFileExplicit` records whether the user selected the entry.
- `lineIds[fileId]` stores durable source-line identities.
- `notes[fileId]` attaches manual notes to those line identities.
- `simulationScenario.outcomes` uses opaque keys whose file component is the
  durable file ID.

Root `AUTOEXEC.BAT` is the automatic entry preference, followed by the first
BAT and then the first supported file. Explicit entry selection overrides that
preference until the selected file is deleted.

Renaming a file preserves its ID and attached metadata. Replacing a file
preserves its ID and entry designation but clears notes, line identities, and
command outcomes because they describe the replaced source. Deleting a file
removes its attached metadata and chooses a new entry when necessary.

## Paths and imports

Safe project paths are relative and cannot contain empty components, dot
components, parent traversal, absolute or drive-qualified roots, or control
characters. Project files use BAT, SYS, or TXT extensions.

User-entered rename destinations require DOS 8.3 components. Imported
noncompliant names remain unchanged and receive warnings. Components are
limited to a one-to-eight-character base and optional one-to-three-character
extension using ASCII letters, digits, or:

```text
$ % ' - _ @ ~ ` ! ( ) { } ^ # &
```

Spaces, extra periods, reserved DOS device names, and unknown OEM characters
are noncompliant. BATFlow warns, but does not block, when a safe imported path
exceeds the classic relative short-path budget.

Folder imports record only supported source files. The user explicitly chooses
whether the selected folder becomes the project root or remains a top-level
directory. Unsupported files are skipped with a summary. Source imports are
preflighted atomically, and every DOS-insensitive collision requires Replace,
Keep both, or Skip. Keep both preserves an imported directory path and
generates a unique DOS 8.3 filename.

## Simulation and compatibility

The single active `simulationScenario` remains shared across project files.
Its `variables`, `paths`, and `outcomes` maps round-trip through browser
storage and project export. Unknown path state is represented by an absent
entry. ERRORLEVEL outcomes are integers from `0` through `255`. Previously
accepted larger values are cleared during recovery without discarding the
project.

An absent `config` variable permits live derivation from CONFIG.SYS
`MENUDEFAULT`; an explicitly stored empty `config` suppresses that default.
Named scenarios are not part of format version 2.

Format version 1 and recognized unversioned projects migrate before replacing
the open project. Migration assigns file IDs, rekeys notes, line identities,
and recognized outcome identities, and selects the preferred entry. If a
version 1 project contains case- or separator-only path collisions, migration
preserves every file and assigns later collisions unique DOS 8.3 filenames.
Unknown future versions are rejected. Version 2 is then persisted and
exported; IndexedDB remains schema version 1.

BATFlow accepts UTF-8 input with an optional byte-order mark. It rejects invalid
UTF-8 instead of guessing DOS code pages. Mixed line endings are reported and
normalize to CRLF when edited.
