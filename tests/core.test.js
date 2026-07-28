import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBatch,
  parseIf,
  reconcileLineIds,
  resolveBatchTarget,
  splitSource,
} from "../public/lib/batch-core.js";
import { collectOutcomeRequests, simulate } from "../public/lib/simulation.js";

function idsFor(text) {
  return splitSource(text).lines.map((_, index) => `line:${index}`);
}

function parse(text, path = "AUTOEXEC.BAT", projectFiles = {}) {
  return parseBatch(text, path, {
    lineIds: idsFor(text),
    projectFiles,
  });
}

test("prefixed structural commands retain their parser kinds", () => {
  const parsed = parse(
    [
      "@goto done",
      "@set MODE=TEST",
      "@call child.bat",
      '@if "%MODE%"=="TEST" goto done',
      "@rem comment",
      ":done",
    ].join("\r\n"),
    "main.bat",
    {
      "main.bat": { content: "" },
      "child.bat": { content: "" },
    },
  );

  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ["goto", "set", "call", "if", "comment", "label"],
  );
});

test("quoted IF EXIST operands and quoted CALL targets remain intact", () => {
  assert.deepEqual(
    parseIf('IF EXIST "C:\\Program Files\\tool.exe" GOTO done'),
    {
      type: "exist",
      negated: false,
      operand: "C:\\Program Files\\tool.exe",
      action: "GOTO done",
    },
  );

  const files = {
    "caller.bat": { content: "" },
    "dir/My Tool.BAT": { content: "" },
  };
  const call = parse('CALL "dir/My Tool.BAT" argument', "caller.bat", files)
    .blocks[0];
  assert.equal(call.kind, "call");
  assert.equal(call.data.target, "dir/My Tool.BAT");
  assert.deepEqual(call.data.args, ["argument"]);
  assert.equal(
    resolveBatchTarget(call.data.target, "caller.bat", files),
    "dir/My Tool.BAT",
  );
});

test("qualified target resolution never falls back to an unrelated basename", () => {
  const files = {
    "elsewhere/FOO.BAT": { content: "" },
  };
  assert.equal(
    resolveBatchTarget("missing/FOO.BAT", "AUTOEXEC.BAT", files),
    null,
  );
  assert.equal(
    resolveBatchTarget("foo", "AUTOEXEC.BAT", files),
    "elsewhere/FOO.BAT",
  );
});

test("consecutive aliases form one diagram section", () => {
  const parsed = parse(":one\r\n:two\r\necho ready");
  assert.equal(parsed.sections.length, 1);
  assert.deepEqual(parsed.sections[0].labels, ["one", "two"]);
});

test("BAT arguments to built-ins are not direct transfers", () => {
  const files = {
    "main.bat": { content: "" },
    "other.bat": { content: "" },
  };
  const parsed = parse(
    [
      "COPY other.bat backup.bat",
      "ECHO other.bat",
      "REN other.bat renamed.bat",
      "other.bat argument",
    ].join("\r\n"),
    "main.bat",
    files,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ["command", "command", "command", "batch-transfer"],
  );
});

test("durable IDs survive insertion, deletion, and in-place replacement", () => {
  const oldLines = ["echo one", "echo two", "echo three"];
  const oldIds = ["one", "two", "three"];
  let sequence = 0;
  const makeId = () => `new:${sequence++}`;
  const inserted = reconcileLineIds(
    oldLines,
    oldIds,
    ["echo zero", ...oldLines],
    makeId,
  );
  assert.deepEqual(inserted.slice(1), oldIds);

  const replaced = reconcileLineIds(
    oldLines,
    oldIds,
    ["echo one", "echo changed", "echo three"],
    makeId,
  );
  assert.deepEqual(replaced, oldIds);

  const deleted = reconcileLineIds(
    oldLines,
    oldIds,
    ["echo one", "echo three"],
    makeId,
  );
  assert.deepEqual(deleted, ["one", "three"]);
});

test("CHOICE exposes and consumes a flow-relevant ERRORLEVEL outcome", () => {
  const source = [
    "choice Continue",
    "if errorlevel 2 goto no",
    "goto yes",
    ":no",
    "exit",
    ":yes",
    "exit",
  ].join("\r\n");
  const parsed = parse(source);
  const requests = collectOutcomeRequests(parsed);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].source, "choice");

  const missing = simulate(parsed);
  assert.equal(missing.status, "input-required");

  const result = simulate(parsed, {
    outcomes: { [requests[0].key]: 2 },
  });
  assert.equal(result.status, "exited");
  assert.ok(result.trace.some((row) => row.result === "Entered :no"));
  assert.ok(
    result.trace.some((row) => row.result === "TRUE · ERRORLEVEL 2 >= 2"),
  );

  const outOfRange = simulate(parsed, {
    outcomes: { [requests[0].key]: 256 },
  });
  assert.equal(outOfRange.status, "input-required");
});

test("outcome identities are scoped by file and producing command", () => {
  const choiceSource = [
    "choice Continue",
    "if errorlevel 2 goto no",
    ":no",
    "exit",
  ].join("\r\n");
  const externalSource = [
    "danger.exe",
    "if errorlevel 2 goto no",
    ":no",
    "exit",
  ].join("\r\n");
  const mainRequest = collectOutcomeRequests(
    parse(choiceSource, "MAIN.BAT"),
  )[0];
  const otherFileRequest = collectOutcomeRequests(
    parse(choiceSource, "OTHER.BAT"),
  )[0];
  const slashVariantRequest = collectOutcomeRequests(
    parse(choiceSource, "DIR/MAIN.BAT"),
  )[0];
  const backslashVariantRequest = collectOutcomeRequests(
    parse(choiceSource, "DIR\\MAIN.BAT"),
  )[0];
  const changedCommandRequest = collectOutcomeRequests(
    parse(externalSource, "MAIN.BAT"),
  )[0];
  const caseChangedArgumentRequest = collectOutcomeRequests(
    parse(
      ["danger.exe /Mode=Alpha", "if errorlevel 2 goto no", ":no", "exit"].join(
        "\r\n",
      ),
      "MAIN.BAT",
    ),
  )[0];
  const lowerCaseArgumentRequest = collectOutcomeRequests(
    parse(
      ["danger.exe /Mode=alpha", "if errorlevel 2 goto no", ":no", "exit"].join(
        "\r\n",
      ),
      "MAIN.BAT",
    ),
  )[0];

  assert.notEqual(mainRequest.key, otherFileRequest.key);
  assert.notEqual(slashVariantRequest.key, backslashVariantRequest.key);
  assert.notEqual(mainRequest.key, changedCommandRequest.key);
  assert.notEqual(caseChangedArgumentRequest.key, lowerCaseArgumentRequest.key);
});

test("conditional transfers and EXIT are modeled as control flow", () => {
  const source = ['if "%MODE%"=="TEST" child.bat', "echo unreachable"].join(
    "\r\n",
  );
  const files = {
    "main.bat": { content: source },
    "child.bat": { content: "exit" },
  };
  const parsed = parse(source, "main.bat", files);
  const result = simulate(
    parsed,
    { variables: { mode: "TEST" } },
    { projectFiles: files },
  );
  assert.equal(result.status, "transferred");
  assert.match(result.stop, /child\.bat/i);

  const exited = simulate(parse("echo before\r\nexit\r\necho after"));
  assert.equal(exited.status, "exited");
  assert.equal(
    exited.trace.some((row) => row.text.includes("echo after")),
    false,
  );
});

test("the global step limit is never reported as completion", () => {
  const commands = Array.from({ length: 20 }, (_, index) => `echo ${index}`);
  const parsed = parse([":loop", ...commands, "goto loop"].join("\r\n"));
  const result = simulate(parsed, {}, { maxSteps: 1000, maxVisits: 1000 });
  assert.equal(result.status, "step-limit");
  assert.equal(result.stop, "Step limit reached (1000)");
});

test("CONFIG.SYS menu values are authoritative and case-deduplicated", () => {
  const source = [
    "if %config%==normal goto normal",
    "goto %config%",
    ":normal",
  ].join("\r\n");
  const parsed = parse(source, "AUTOEXEC.BAT", {
    "AUTOEXEC.BAT": { content: source },
    "CONFIG.SYS": {
      content: [
        "[MENU]",
        "MENUITEM=NORMAL,Normal startup",
        "MENUITEM=SAFE,Safe startup",
        "MENUDEFAULT=NORMAL,5",
      ].join("\r\n"),
    },
  });
  const config = parsed.variables.find(
    (item) => item.name.toLowerCase() === "config",
  );
  assert.deepEqual(config.values, ["NORMAL", "SAFE"]);
  assert.equal(parsed.configInfo.menuDefault, "NORMAL");
});

test("CONFIG.SYS selections compare using DOS config-value casing", () => {
  const source = [
    "if %config%==safe goto safe",
    "echo continue",
    "if %config%==normal goto normal",
    "exit",
    ":safe",
    "exit",
    ":normal",
    "exit",
  ].join("\r\n");
  const result = simulate(parse(source), {
    variables: { config: "NORMAL" },
  });
  const conditions = result.trace
    .filter((row) => row.event === "condition")
    .map((row) => row.result);
  assert.deepEqual(conditions, ["FALSE", "TRUE"]);
  assert.ok(result.trace.some((row) => row.result === "Entered :normal"));
});

test("an explicitly unset CONFIG evaluates empty and execution continues", () => {
  const parsed = parse(
    'if "%config%"=="NORMAL" echo normal\r\nexit',
    "AUTOEXEC.BAT",
  );
  const result = simulate(parsed, {
    variables: { config: "" },
  });

  assert.equal(result.status, "exited");
  assert.ok(
    result.trace.some(
      (row) => row.event === "condition" && row.result === "FALSE",
    ),
  );
});

test("an empty dynamic GOTO terminates the batch as a runtime error", () => {
  const parsed = parse("goto %config%\r\necho unreachable", "AUTOEXEC.BAT");
  const result = simulate(parsed, {
    variables: { config: "" },
  });

  assert.equal(result.status, "terminated");
  assert.equal(result.stop, "Batch terminated: GOTO label missing");
  assert.ok(
    result.trace.some(
      (row) => row.result === "Required GOTO label missing; batch terminated",
    ),
  );
  assert.equal(
    result.trace.some((row) => row.text === "echo unreachable"),
    false,
  );
});

test("a literal GOTO without a label terminates direct and conditional flow", () => {
  const direct = simulate(parse("goto\r\necho unreachable"));
  assert.equal(direct.status, "terminated");
  assert.equal(direct.stop, "Batch terminated: GOTO label missing");
  assert.equal(
    direct.trace.some((row) => row.text === "echo unreachable"),
    false,
  );

  const conditional = simulate(parse('if "x"=="x" goto\r\necho unreachable'));
  assert.equal(conditional.status, "terminated");
  assert.equal(conditional.stop, "Batch terminated: GOTO label missing");
  assert.equal(
    conditional.trace.some((row) => row.text === "echo unreachable"),
    false,
  );
});

test("a dynamic GOTO without an input remains distinguishable", () => {
  const parsed = parse("goto %config%\r\necho unreachable", "AUTOEXEC.BAT");
  const result = simulate(parsed);

  assert.equal(result.status, "input-required");
  assert.equal(result.stop, "Input required for GOTO %config%");
});
