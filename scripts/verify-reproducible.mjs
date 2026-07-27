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
const archivePath = path.join(
  artifactDirectory,
  `batflow-${PRODUCT_VERSION}.zip`,
);

function build() {
  execFileSync(process.execPath, ["scripts/package-release.mjs"], {
    stdio: "ignore",
    env: process.env,
  });
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

build();
const first = digest(await readFile(archivePath));
build();
const second = digest(await readFile(archivePath));
assert.equal(first, second, "consecutive release archives must be identical");
console.log(`Reproducible archive: ${first}`);
