import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_FORMAT_VERSION,
  ProjectFormatError,
  addTextFile,
  analyzeProjectPath,
  createProject,
  decodeUtf8,
  deleteProjectFile,
  deleteProjectLine,
  duplicateProjectLine,
  filePathForId,
  importProjectDocument,
  renameProjectFile,
  serializeProject,
  setProjectEntryFile,
  uniqueDosProjectPath,
  updateFileContent,
  updateProjectName,
  updateProjectSimulationScenario,
} from "../public/lib/project-format.js";

function fileId(project, path) {
  return project.files[path].id;
}

test("versioned project documents round-trip without losing durable metadata", () => {
  let project = createProject("Round trip");
  project = addTextFile(project, "AUTOEXEC.BAT", "echo one\r\necho two\r\n", {
    makeId: (() => {
      let next = 0;
      return () => `line:${next++}`;
    })(),
  });
  const autoexecId = fileId(project, "AUTOEXEC.BAT");
  project.metadata.notes[autoexecId]["line:1"] = "Keep this note";

  const document = JSON.parse(serializeProject(project));
  assert.equal(document.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(document.createdBy.productVersion, "0.5.3");
  assert.equal(document.interpreterProfile, "msdos-7.1-command.com");

  const imported = importProjectDocument(document);
  assert.equal(imported.migrated, false);
  assert.equal(
    imported.project.metadata.notes[autoexecId]["line:1"],
    "Keep this note",
  );
});

test("simulation scenarios normalize and round-trip with the project", () => {
  const original = createProject("Scenario");
  const updated = updateProjectSimulationScenario(original, {
    variables: { CONFIG: "NORMAL", Mode: "Safe" },
    paths: { "C:/TOOLS/APP.EXE": "yes" },
    outcomes: { "line:choice": 2 },
  });

  assert.deepEqual(original.metadata.simulationScenario, {
    variables: {},
    paths: {},
    outcomes: {},
  });
  assert.deepEqual(updated.metadata.simulationScenario, {
    variables: { config: "NORMAL", mode: "Safe" },
    paths: { "c:\\tools\\app.exe": "yes" },
    outcomes: { "line:choice": 2 },
  });

  const imported = importProjectDocument(JSON.parse(serializeProject(updated)));
  assert.deepEqual(
    imported.project.metadata.simulationScenario,
    updated.metadata.simulationScenario,
  );
});

test("an explicitly unset CONFIG survives project round-trip", () => {
  const updated = updateProjectSimulationScenario(createProject(), {
    variables: { config: "", empty: "" },
    paths: {},
    outcomes: {},
  });

  assert.deepEqual(updated.metadata.simulationScenario.variables, {
    config: "",
  });
  const imported = importProjectDocument(JSON.parse(serializeProject(updated)));
  assert.equal(
    Object.hasOwn(
      imported.project.metadata.simulationScenario.variables,
      "config",
    ),
    true,
  );
  assert.equal(
    imported.project.metadata.simulationScenario.variables.config,
    "",
  );
});

test("scenario maps preserve hostile but valid DOS names", () => {
  const variables = JSON.parse('{"__proto__":"VALUE"}');
  const outcomes = JSON.parse('{"__proto__":7}');
  const updated = updateProjectSimulationScenario(createProject(), {
    variables,
    paths: {},
    outcomes,
  });
  const roundTrip = importProjectDocument(JSON.parse(serializeProject(updated)))
    .project.metadata.simulationScenario;

  assert.equal(Object.hasOwn(roundTrip.variables, "__proto__"), true);
  assert.equal(roundTrip.variables.__proto__, "VALUE");
  assert.equal(Object.hasOwn(roundTrip.outcomes, "__proto__"), true);
  assert.equal(roundTrip.outcomes.__proto__, 7);
});

test("missing scenarios default safely and malformed scenarios are rejected", () => {
  const imported = importProjectDocument({
    formatVersion: PROJECT_FORMAT_VERSION,
    project: {
      id: "project:old-v1",
      name: "Old version 1",
      files: {},
      metadata: { notes: {}, lineIds: {} },
    },
  });
  assert.deepEqual(imported.project.metadata.simulationScenario, {
    variables: {},
    paths: {},
    outcomes: {},
  });

  assert.throws(
    () =>
      updateProjectSimulationScenario(createProject(), {
        variables: { mode: 1 },
        paths: {},
        outcomes: {},
      }),
    /Simulation variable/,
  );
  assert.throws(
    () =>
      updateProjectSimulationScenario(createProject(), {
        variables: {},
        paths: { "C:\\BAD": "unknown" },
        outcomes: {},
      }),
    /Simulation path/,
  );
  assert.throws(
    () =>
      updateProjectSimulationScenario(createProject(), {
        variables: {},
        paths: {},
        outcomes: { choice: -1 },
      }),
    /0 through 255/,
  );
  assert.throws(
    () =>
      updateProjectSimulationScenario(createProject(), {
        variables: {},
        paths: {},
        outcomes: { choice: 256 },
      }),
    /0 through 255/,
  );
  assert.throws(
    () =>
      importProjectDocument({
        formatVersion: PROJECT_FORMAT_VERSION,
        project: {
          id: "project:malformed",
          name: "Malformed scenario",
          files: {},
          metadata: {
            notes: {},
            lineIds: {},
            simulationScenario: { variables: null },
          },
        },
      }),
    /Simulation variables/,
  );
});

test("imports recover projects by clearing previously accepted oversized outcomes", () => {
  const project = updateProjectSimulationScenario(createProject("Recovery"), {
    variables: { mode: "SAFE" },
    paths: {},
    outcomes: { valid: 2 },
  });
  const document = JSON.parse(serializeProject(project));
  document.project.metadata.simulationScenario.outcomes.oversized = 1e31;

  const imported = importProjectDocument(document);

  assert.equal(imported.discardedSimulationOutcomes, 1);
  assert.deepEqual(imported.project.metadata.simulationScenario, {
    variables: { mode: "SAFE" },
    paths: {},
    outcomes: { valid: 2 },
  });
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
  const mainId = fileId(project, "MAIN.BAT");
  project.metadata.notes[mainId]["id:1"] = "second";

  project = updateFileContent(
    project,
    "MAIN.BAT",
    "echo inserted\necho one\necho two\n",
    { makeId: () => "id:inserted" },
  );
  assert.equal(project.files["MAIN.BAT"].lineEnding, "LF");
  assert.equal(project.files["MAIN.BAT"].content.includes("\r"), false);
  assert.deepEqual(project.metadata.lineIds[mainId].slice(1, 3), [
    "id:0",
    "id:1",
  ]);
  assert.equal(project.metadata.notes[mainId]["id:1"], "second");

  project = duplicateProjectLine(project, "MAIN.BAT", 2);
  assert.notEqual(
    project.metadata.lineIds[mainId][2],
    project.metadata.lineIds[mainId][3],
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
  assert.equal(project.metadata.lineIds[fileId(project, "ONE.BAT")].length, 1);
});

test("project format 1 migrates path metadata and outcomes to durable file IDs", () => {
  const outcomeKey = JSON.stringify([
    "DIR/MAIN.BAT",
    "line:1",
    "command",
    "choice",
  ]);
  const imported = importProjectDocument({
    formatVersion: 1,
    project: {
      id: "project:v1",
      name: "Version one",
      files: {
        "DIR/MAIN.BAT": {
          content: "choice\r\nexit",
          encoding: "utf-8",
          lineEnding: "CRLF",
        },
      },
      metadata: {
        notes: { "DIR/MAIN.BAT": { "line:1": "note" } },
        lineIds: { "DIR/MAIN.BAT": ["line:1", "line:2"] },
        simulationScenario: {
          variables: {},
          paths: {},
          outcomes: { [outcomeKey]: 2 },
        },
      },
    },
  });

  const id = fileId(imported.project, "DIR/MAIN.BAT");
  assert.equal(imported.migrated, true);
  assert.equal(imported.sourceFormat, "batflow-1");
  assert.equal(imported.project.metadata.notes[id]["line:1"], "note");
  assert.deepEqual(imported.project.metadata.lineIds[id], ["line:1", "line:2"]);
  assert.equal(imported.project.metadata.entryFileId, id);
  assert.equal(
    imported.project.metadata.simulationScenario.outcomes[
      JSON.stringify([id, "line:1", "command", "choice"])
    ],
    2,
  );
});

test("project format 1 preserves DOS-insensitive path collisions with unique names", () => {
  const firstOutcome = JSON.stringify([
    "Foo.BAT",
    "line:first",
    "command",
    "choice",
  ]);
  const secondOutcome = JSON.stringify([
    "foo.bat",
    "line:second",
    "command",
    "choice",
  ]);
  const imported = importProjectDocument({
    formatVersion: 1,
    project: {
      id: "project:v1-collision",
      name: "Colliding v1",
      files: {
        "Foo.BAT": { content: "choice", lineEnding: "CRLF" },
        "foo.bat": { content: "choice", lineEnding: "CRLF" },
      },
      metadata: {
        notes: {
          "Foo.BAT": { "line:first": "first" },
          "foo.bat": { "line:second": "second" },
        },
        lineIds: {
          "Foo.BAT": ["line:first"],
          "foo.bat": ["line:second"],
        },
        simulationScenario: {
          variables: {},
          paths: {},
          outcomes: { [firstOutcome]: 1, [secondOutcome]: 2 },
        },
      },
    },
  });

  const firstId = fileId(imported.project, "Foo.BAT");
  const secondId = fileId(imported.project, "FOO~1.BAT");
  assert.deepEqual(Object.keys(imported.project.files), [
    "Foo.BAT",
    "FOO~1.BAT",
  ]);
  assert.equal(imported.project.metadata.notes[firstId]["line:first"], "first");
  assert.equal(
    imported.project.metadata.notes[secondId]["line:second"],
    "second",
  );
  assert.equal(
    imported.project.metadata.simulationScenario.outcomes[
      JSON.stringify([firstId, "line:first", "command", "choice"])
    ],
    1,
  );
  assert.equal(
    imported.project.metadata.simulationScenario.outcomes[
      JSON.stringify([secondId, "line:second", "command", "choice"])
    ],
    2,
  );
});

test("file lifecycle preserves identity on rename and clears stale replacement state", () => {
  let project = addTextFile(
    createProject("Lifecycle"),
    "AUTOEXEC.BAT",
    "choice\r\nexit",
    { makeId: () => "line:one" },
  );
  const id = fileId(project, "AUTOEXEC.BAT");
  project.metadata.notes[id]["line:one"] = "keep through rename";
  const outcomeKey = JSON.stringify([id, "line:one", "command", "choice"]);
  project = updateProjectSimulationScenario(project, {
    variables: { mode: "SAFE" },
    paths: {},
    outcomes: { [outcomeKey]: 2 },
  });

  project = renameProjectFile(project, "AUTOEXEC.BAT", "BOOT\\START.BAT");
  assert.equal(filePathForId(project, id), "BOOT\\START.BAT");
  assert.equal(project.metadata.notes[id]["line:one"], "keep through rename");
  assert.equal(project.metadata.simulationScenario.outcomes[outcomeKey], 2);
  assert.equal(project.metadata.entryFileId, id);

  project = addTextFile(project, "boot/start.bat", "echo replacement", {
    replace: true,
    makeId: () => "line:new",
  });
  assert.equal(fileId(project, "BOOT\\START.BAT"), id);
  assert.deepEqual(project.metadata.notes[id], {});
  assert.deepEqual(project.metadata.lineIds[id], ["line:new"]);
  assert.deepEqual(project.metadata.simulationScenario.outcomes, {});
  assert.equal(project.metadata.entryFileId, id);
});

test("entry preference, explicit entry, deletion, and project naming are durable", () => {
  let project = createProject();
  project = addTextFile(project, "CONFIG.SYS", "menuitem=NORMAL");
  project = addTextFile(project, "TOOLS.BAT", "exit");
  project = addTextFile(project, "AUTOEXEC.BAT", "exit");
  assert.equal(
    filePathForId(project, project.metadata.entryFileId),
    "AUTOEXEC.BAT",
  );

  project = setProjectEntryFile(project, fileId(project, "CONFIG.SYS"));
  project = deleteProjectFile(project, "CONFIG.SYS");
  assert.equal(
    filePathForId(project, project.metadata.entryFileId),
    "AUTOEXEC.BAT",
  );
  project = setProjectEntryFile(project, fileId(project, "TOOLS.BAT"));
  project = updateProjectName(project, "Boot disk");
  assert.equal(project.name, "Boot disk");
  assert.equal(
    filePathForId(project, project.metadata.entryFileId),
    "TOOLS.BAT",
  );
  assert.throws(() => updateProjectName(project, "   "), /non-empty/);
});

test("DOS path analysis and collision generation preserve imported spelling", () => {
  assert.equal(analyzeProjectPath("DOS\\SETUP.BAT").dos83Compliant, true);
  assert.equal(analyzeProjectPath("lower\\case.txt").dos83Compliant, true);
  for (const path of [
    "TOO-LONG9.BAT",
    "BAD NAME.BAT",
    "A.B.C",
    "CON.TXT",
    "DIR\\COM1",
    "CAFÉ.BAT",
  ]) {
    assert.equal(analyzeProjectPath(path).dos83Compliant, false, path);
  }
  assert.equal(analyzeProjectPath("LONG DIRECTORY/FILE.BAT").safe, true);
  assert.match(
    analyzeProjectPath("LONG DIRECTORY/FILE.BAT").warnings[0],
    /8\.3/,
  );
  assert.equal(analyzeProjectPath("../FILE.BAT").safe, false);
  assert.equal(analyzeProjectPath("C:FOO.BAT").safe, false);

  let project = addTextFile(createProject(), "AUTOEXEC.BAT", "exit");
  assert.equal(uniqueDosProjectPath(project, "AUTOEXEC.BAT"), "AUTOEX~1.BAT");
  project = addTextFile(project, "AUTOEX~1.BAT", "exit");
  assert.equal(uniqueDosProjectPath(project, "autoexec.bat"), "AUTOEX~2.BAT");
  project = addTextFile(project, "Long Folder/Long Name.BAT", "exit");
  assert.equal(
    uniqueDosProjectPath(project, "Long Folder/Long Name.BAT"),
    "Long Folder/LONGNA~1.BAT",
  );
  assert.throws(
    () => renameProjectFile(project, "AUTOEXEC.BAT", "LONG NAME.BAT"),
    /8\.3/,
  );
  assert.throws(
    () => addTextFile(project, "autoexec.bat", "collision"),
    /already exists/,
  );
  assert.throws(() => addTextFile(project, "C:FOO.BAT", "exit"), /relative/);
  project = renameProjectFile(project, "AUTOEXEC.BAT", "autoexec.bat");
  assert.ok(project.files["autoexec.bat"]);
});

test("format 2 rejects duplicate file identities and safely retains hostile IDs", () => {
  const project = addTextFile(createProject(), "ONE.BAT", "exit");
  const document = JSON.parse(serializeProject(project));
  const first = document.project.files["ONE.BAT"];
  document.project.files["TWO.BAT"] = { ...first };
  assert.throws(
    () => importProjectDocument(document),
    /Duplicate project file ID/,
  );

  delete document.project.files["TWO.BAT"];
  first.id = "__proto__";
  document.project.metadata.lineIds = JSON.parse('{"__proto__":["line:one"]}');
  document.project.metadata.notes = JSON.parse(
    '{"__proto__":{"line:one":"safe"}}',
  );
  document.project.metadata.entryFileId = "__proto__";
  const imported = importProjectDocument(document).project;
  assert.equal(Object.hasOwn(imported.metadata.notes, "__proto__"), true);
});
