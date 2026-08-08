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
  assert.equal(run.stop, "Complete");
});
