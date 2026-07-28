import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_FORMAT_VERSION,
  ProjectFormatError,
  addTextFile,
  createProject,
  decodeUtf8,
  deleteProjectLine,
  duplicateProjectLine,
  importProjectDocument,
  serializeProject,
  updateFileContent,
} from "../public/lib/project-format.js";

test("versioned project documents round-trip without losing durable metadata", () => {
  let project = createProject("Round trip");
  project = addTextFile(project, "AUTOEXEC.BAT", "echo one\r\necho two\r\n", {
    makeId: (() => {
      let next = 0;
      return () => `line:${next++}`;
    })(),
  });
  project.metadata.notes["AUTOEXEC.BAT"]["line:1"] = "Keep this note";

  const document = JSON.parse(serializeProject(project));
  assert.equal(document.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(document.createdBy.productVersion, "0.5.0");
  assert.equal(document.interpreterProfile, "msdos-7.1-command.com");

  const imported = importProjectDocument(document);
  assert.equal(imported.migrated, false);
  assert.equal(
    imported.project.metadata.notes["AUTOEXEC.BAT"]["line:1"],
    "Keep this note",
  );
});

test("legacy projects migrate and future project formats are rejected", () => {
  const imported = importProjectDocument({
    name: "passes export",
    files: {
      "START.BAT": {
        content: "echo legacy\n",
      },
    },
    metadata: {},
  });
  assert.equal(imported.migrated, true);
  assert.equal(imported.sourceFormat, "legacy-unversioned");

  assert.throws(
    () =>
      importProjectDocument({
        formatVersion: PROJECT_FORMAT_VERSION + 1,
        project: imported.project,
      }),
    ProjectFormatError,
  );
});

test("editing preserves line endings and reconciles identities and notes", () => {
  let project = createProject("Line endings");
  project = addTextFile(project, "MAIN.BAT", "echo one\necho two\n", {
    makeId: (() => {
      let next = 0;
      return () => `id:${next++}`;
    })(),
  });
  project.metadata.notes["MAIN.BAT"]["id:1"] = "second";

  project = updateFileContent(
    project,
    "MAIN.BAT",
    "echo inserted\necho one\necho two\n",
    { makeId: () => "id:inserted" },
  );
  assert.equal(project.files["MAIN.BAT"].lineEnding, "LF");
  assert.equal(project.files["MAIN.BAT"].content.includes("\r"), false);
  assert.deepEqual(project.metadata.lineIds["MAIN.BAT"].slice(1, 3), [
    "id:0",
    "id:1",
  ]);
  assert.equal(project.metadata.notes["MAIN.BAT"]["id:1"], "second");

  project = duplicateProjectLine(project, "MAIN.BAT", 2);
  assert.notEqual(
    project.metadata.lineIds["MAIN.BAT"][2],
    project.metadata.lineIds["MAIN.BAT"][3],
  );
  project = deleteProjectLine(project, "MAIN.BAT", 0);
  assert.equal(
    project.files["MAIN.BAT"].content.startsWith("echo one\n"),
    true,
  );
});

test("mixed line endings normalize explicitly and invalid UTF-8 is rejected", () => {
  let project = createProject();
  project = addTextFile(project, "MIXED.BAT", "echo one\r\necho two\n");
  assert.equal(project.files["MIXED.BAT"].lineEnding, "CRLF");
  assert.equal(project.files["MIXED.BAT"].normalizedFromMixedLineEndings, true);

  assert.equal(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), "A");
  assert.throws(
    () => decodeUtf8(new Uint8Array([0xc3, 0x28])),
    /not valid UTF-8/,
  );
});

test("unsafe project paths are rejected", () => {
  const project = createProject();
  assert.throws(
    () => addTextFile(project, "../AUTOEXEC.BAT", "echo unsafe"),
    ProjectFormatError,
  );
  assert.throws(
    () => addTextFile(project, "C:\\AUTOEXEC.BAT", "echo unsafe"),
    ProjectFormatError,
  );
});

test("deleting the only source line leaves one durable blank line", () => {
  let project = addTextFile(createProject(), "ONE.BAT", "exit");
  project = deleteProjectLine(project, "ONE.BAT", 0);
  assert.equal(project.files["ONE.BAT"].content, "");
  assert.equal(project.metadata.lineIds["ONE.BAT"].length, 1);
});
