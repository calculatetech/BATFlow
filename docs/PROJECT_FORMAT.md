# BATFlow project format

BATFlow 0.5.1 exports UTF-8 JSON files named `*.batflow`. The top-level
envelope keeps independent version domains:

```json
{
  "formatVersion": 1,
  "createdBy": {
    "product": "BATFlow",
    "productVersion": "0.5.1"
  },
  "interpreterProfile": "msdos-7.1-command.com",
  "project": {}
}
```

`formatVersion` governs import compatibility. It is not the BATFlow product
version or IndexedDB schema version. Version 1 projects contain a project ID,
name, file records, and metadata. Each file records UTF-8 encoding and its
preferred `CRLF`, `LF`, or `CR` line ending. Durable opaque line IDs bind notes
and navigation state to source lines.

Project metadata also contains one active `simulationScenario`. Its
`variables`, `paths`, and `outcomes` maps are shared across project files and
round-trip through browser storage and project export. Unknown path state is
represented by an absent entry. Outcome map keys are opaque identities scoped
to the project file and producing command; consumers must not construct or
interpret them. ERRORLEVEL outcomes are integers from `0` through `255`.
Previously accepted larger values are cleared during import or storage recovery
without discarding the rest of the project. An absent `config` variable permits
live derivation from CONFIG.SYS `MENUDEFAULT`; an explicitly stored empty
`config` suppresses that default and evaluates as an empty DOS variable until
simulation inputs are reset. Named scenarios are not part of format version 1.

Imports are fully parsed and validated before replacing the open project.
Absolute paths, parent traversal, malformed data, and unknown future versions
are rejected. Unversioned legacy JSON with `name`, `files`, and `metadata` is
accepted and upgraded in memory; the next export uses the versioned envelope.

BATFlow 0.5.1 accepts UTF-8 input with an optional byte-order mark. It rejects
invalid UTF-8 instead of guessing DOS code pages. Mixed line endings are
reported in file metadata and normalized to CRLF when the file is edited.
