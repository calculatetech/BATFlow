import assert from "node:assert/strict";
import test from "node:test";

import {
  expand,
  parseBatch,
  parseCommand,
  parseIf,
  splitArgs,
} from "../public/lib/batch.js";
import { buildBatchFlow } from "../public/lib/flow.js";

const source = (text, path = "AUTOEXEC.BAT") => ({
  key: path.toLowerCase(),
  path,
  text,
});

test("DOS quoting, prefixes, variables, and the three IF forms parse", () => {
  assert.deepEqual(splitArgs('"C:\\Program Files\\TOOL.BAT" one'), [
    "C:\\Program Files\\TOOL.BAT",
    "one",
  ]);
  assert.equal(expand("%MODE%/%MISSING%", { mode: "NET" }), "NET/%MISSING%");
  assert.equal(parseCommand("@goto done").kind, "goto");
  assert.deepEqual(parseIf("if not errorlevel 2 goto low"), {
    type: "errorlevel",
    negated: true,
    level: 2,
    action: "goto low",
  });
  assert.equal(parseIf('if exist "C:\\Program Files" goto yes').type, "exist");
  assert.equal(parseIf('if "%MODE%"=="NET" goto net').type, "compare");
});

test("all DOS flow-producing command forms have explicit statement kinds", () => {
  const cases = new Map([
    ["for %%F in (*.BAT) do call %%F", "for"],
    ["call CHILD.BAT one two", "call"],
    ["CHILD.BAT one", "transfer"],
    ["shift", "shift"],
    ["choice /c:YN Continue?", "choice"],
    ["command /c CHILD.BAT", "shell-call"],
    ["command /k CHILD.BAT", "shell-transfer"],
    ["tool.exe | find ok", "pipeline"],
    ["exit", "exit"],
  ]);
  for (const [line, kind] of cases) assert.equal(parseCommand(line).kind, kind);
});

test("batch parsing reports duplicate, missing, malformed, and NT-only flow", () => {
  const parsed = parseBatch(
    source(
      [":one", ":one", "goto missing", "for /f %%F in (x) do echo %%F"].join(
        "\n",
      ),
    ),
  );
  assert.deepEqual(
    parsed.diagnostics.map((item) => item.message),
    [
      "Duplicate label :one",
      "Malformed FOR command",
      "NT cmd.exe syntax is outside the MS-DOS 7.1 profile",
      "Label not found: missing",
    ],
  );
});

test("straight-line commands become one process block while branches remain 2D nodes", () => {
  const parsed = parseBatch(
    source(
      [
        "@echo off",
        "set MODE=NET",
        'if "%MODE%"=="NET" goto network',
        "echo local",
        "goto end",
        ":network",
        "call NET.BAT",
        ":end",
        "exit",
      ].join("\n"),
    ),
  );
  const flow = buildBatchFlow(parsed);
  assert.deepEqual(
    flow.nodes.map((node) => node.kind),
    ["start", "process", "decision", "process", "jump", "call", "exit", "end"],
  );
  assert.equal(flow.nodes[1].lines.length, 2);
  assert.deepEqual(flow.nodes[5].labels, ["network"]);
  assert.deepEqual(flow.nodes[6].labels, ["end"]);
  assert.equal(
    flow.edges.filter((item) => item.from === flow.nodes[2].id).length,
    2,
  );
});

test("loops, literal jumps, and dynamic jumps expose every possible edge", () => {
  const parsed = parseBatch(
    source(
      [
        "for %%F in (one two) do echo %%F",
        "goto %TARGET%",
        ":one",
        "echo one",
        ":two",
        "exit",
      ].join("\n"),
    ),
  );
  const flow = buildBatchFlow(parsed);
  const loop = flow.nodes.find((node) => node.kind === "loop");
  const jump = flow.nodes.find((node) => node.kind === "jump");
  assert.deepEqual(
    flow.edges.filter((item) => item.from === loop.id).map((item) => item.role),
    ["loop", "false"],
  );
  assert.deepEqual(
    flow.edges
      .filter((item) => item.from === jump.id)
      .map((item) => item.label),
    [":one", ":two"],
  );
});
