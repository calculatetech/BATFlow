import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import yazl from "yazl";

import { PRODUCT_VERSION } from "../public/lib/project-format.js";

const root = process.cwd();
const distDirectory = path.join(root, "dist");
const artifactDirectory = path.resolve(
  root,
  process.env.BATFLOW_ARTIFACT_DIR || ".agent/test-results",
);
const archiveName = `batflow-${PRODUCT_VERSION}.zip`;
const archivePath = path.join(artifactDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
const fixedDate = new Date("1980-01-01T00:00:00.000Z");

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await filesBelow(path.join(directory, entry.name), relative)),
      );
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await cp(path.join(root, "public"), distDirectory, { recursive: true });
await mkdir(artifactDirectory, { recursive: true });

const zip = new yazl.ZipFile();
for (const relative of await filesBelow(distDirectory)) {
  zip.addFile(path.join(distDirectory, relative), relative, {
    compress: false,
    mtime: fixedDate,
    mode: 0o100644,
  });
}
zip.end();
await new Promise((resolve, reject) => {
  const stream = createWriteStream(archivePath);
  zip.outputStream.pipe(stream);
  stream.on("close", resolve);
  stream.on("error", reject);
  zip.outputStream.on("error", reject);
});

const digest = createHash("sha256")
  .update(await readFile(archivePath))
  .digest("hex");
await writeFile(checksumPath, `${digest}  ${archiveName}\n`);
console.log(`${archivePath}\n${checksumPath}`);
