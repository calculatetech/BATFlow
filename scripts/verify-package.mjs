import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { PRODUCT_VERSION } from "../public/lib/project-format.js";

const artifactDirectory = path.resolve(
  process.cwd(),
  process.env.BATFLOW_ARTIFACT_DIR || ".agent/test-results",
);
const archiveName = `batflow-${PRODUCT_VERSION}.zip`;
const archivePath = path.join(artifactDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
const archive = await readFile(archivePath);
const expectedDigest = (await readFile(checksumPath, "utf8")).split(/\s+/)[0];
const actualDigest = createHash("sha256").update(archive).digest("hex");
assert.equal(actualDigest, expectedDigest, "release checksum");

const entries = execFileSync("unzip", ["-Z1", archivePath], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
assert.ok(entries.includes("index.html"));
assert.ok(entries.includes("app.js"));
assert.ok(entries.includes("styles.css"));
assert.ok(entries.includes("lib/batch-core.js"));
for (const entry of entries) {
  assert.doesNotMatch(entry, /(?:^|\/)(?:\.git|\.agent|docs|tests)(?:\/|$)/);
}
console.log(`Verified ${archiveName} (${actualDigest})`);
