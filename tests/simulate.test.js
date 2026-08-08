import assert from "node:assert/strict";
import test from "node:test";

import { buildProgram } from "../public/lib/flow.js";
import { simulate } from "../public/lib/simulate.js";

const source = (path, text) => ({ key: path.toLowerCase(), path, text });

test("in-block decisions select a path without changing graph topology", () => {
  const program = buildProgram(
    new Map([
      [
        "autoexec.bat",
        source(
          "AUTOEXEC.BAT",
          [
            'if "%MODE%"=="NET" goto net',
            "rem keep source locations exact",
            "echo local",
            "goto end",
            ":net",
            "echo network",
            ":end",
            "call CHILD.BAT",
            "echo returned",
          ].join("\n"),
        ),
      ],
      ["child.bat", source("CHILD.BAT", "echo child")],
    ]),
    "autoexec.bat",
  );
  const decision = program.nodes.find((node) => node.kind === "decision");
  const edgeCount = program.edges.length;
  const local = simulate(program, { [decision.id]: { value: "LOCAL" } });
  const network = simulate(program, { [decision.id]: { value: "NET" } });

  assert.match(
    local.executed.map((row) => row.source).join("\n"),
    /echo local/,
  );
  assert.doesNotMatch(
    local.executed.map((row) => row.source).join("\n"),
    /echo network/,
  );
  assert.match(
    network.executed.map((row) => row.source).join("\n"),
    /echo network/,
  );
  assert.match(
    network.executed.map((row) => row.source).join("\n"),
    /echo child/,
  );
  assert.match(
    network.executed.map((row) => row.source).join("\n"),
    /echo returned/,
  );
  assert.equal(
    local.executed.find((row) => row.source === "echo local").line,
    3,
  );
  assert.equal(program.edges.length, edgeCount);
});

test("FOR calls return for every item before execution continues", () => {
  const program = buildProgram(
    new Map([
      [
        "autoexec.bat",
        source(
          "AUTOEXEC.BAT",
          "for %%F in (one two) do call CHILD.BAT %%F\necho done",
        ),
      ],
      ["child.bat", source("CHILD.BAT", "echo child %1")],
    ]),
    "autoexec.bat",
  );
  const run = simulate(program);
  const lines = run.executed.map((row) => row.source);

  assert.equal(lines.filter((line) => line === "echo child %1").length, 2);
  assert.equal(lines.at(-1), "echo done");
  assert.equal(run.warning, null);
  assert.equal(run.stop, "Complete");
});

test("a confirmed GOTO cycle runs once and reports its closing block", () => {
  const program = buildProgram(
    new Map([
      ["autoexec.bat", source("AUTOEXEC.BAT", ":again\necho once\ngoto again")],
    ]),
    "autoexec.bat",
  );
  const run = simulate(program);

  assert.equal(
    run.executed.filter((row) => row.source === "echo once").length,
    1,
  );
  assert.equal(
    run.executed.filter((row) => row.source === "goto again").length,
    1,
  );
  assert.deepEqual(run.warning, {
    code: "simulation.infinite-loop",
    message: "Infinite loop detected. Simulation stopped after one cycle.",
    nodeId: "node:autoexec.bat:3",
    edgeId: "node:autoexec.bat:3->node:autoexec.bat:2:jump",
    file: "AUTOEXEC.BAT",
    line: 3,
  });
  assert.equal(run.stop, "Infinite loop detected");
});

test("CHOICE defaults to its first key and EXIT does not return from a call", () => {
  const choice = buildProgram(
    new Map([
      [
        "autoexec.bat",
        source(
          "AUTOEXEC.BAT",
          "choice /c:YN\nif errorlevel 1 goto yes\necho no\n:yes\necho yes",
        ),
      ],
    ]),
    "autoexec.bat",
  );
  assert.doesNotMatch(
    simulate(choice)
      .executed.map((row) => row.source)
      .join("\n"),
    /echo no/,
  );

  const exit = buildProgram(
    new Map([
      ["autoexec.bat", source("AUTOEXEC.BAT", "call CHILD.BAT\necho returned")],
      ["child.bat", source("CHILD.BAT", "exit")],
    ]),
    "autoexec.bat",
  );
  assert.doesNotMatch(
    simulate(exit)
      .executed.map((row) => row.source)
      .join("\n"),
    /echo returned/,
  );
});
