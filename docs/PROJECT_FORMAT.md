# BATFlow project format

BATFlow 0.5.0 exports UTF-8 JSON files named `*.batflow`. The top-level
envelope keeps independent version domains:

```json
{
  "formatVersion": 1,
  "createdBy": {
    "product": "BATFlow",
    "productVersion": "0.5.0"
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

Imports are fully parsed and validated before replacing the open project.
Absolute paths, parent traversal, malformed data, and unknown future versions
are rejected. Unversioned legacy JSON with `name`, `files`, and `metadata` is
accepted and upgraded in memory; the next export uses the versioned envelope.

BATFlow 0.5.0 accepts UTF-8 input with an optional byte-order mark. It rejects
invalid UTF-8 instead of guessing DOS code pages. Mixed line endings are
reported in file metadata and normalized to CRLF when the file is edited.
