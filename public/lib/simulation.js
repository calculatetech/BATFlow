import {
  commandToken,
  evaluateIf,
  expand,
  isDosBuiltin,
  nextMeaningfulBlock,
  norm,
  parseDosArgs,
  resolveBatchTarget,
  stripCommandPrefix,
} from "./batch-core.js?v=0.5.4-dev.17";

function actionInfo(action, path, projectFiles) {
  const text = stripCommandPrefix(action);
  let match = text.match(/^goto(?:\s+(.*))?$/i);
  if (match) return { type: "goto", target: match[1] || "" };
  match = text.match(/^set\s+([^=\s]+)=(.*)$/i);
  if (match) return { type: "set", name: match[1], value: match[2] };
  if (/^exit(?:\s|$)/i.test(text)) return { type: "exit" };
  match = text.match(/^call\s+(.+)$/i);
  if (match) {
    const args = parseDosArgs(match[1]);
    return { type: "call", target: args[0] || "", args: args.slice(1) };
  }

  const args = parseDosArgs(text);
  const token = args[0] || "";
  if (
    token &&
    !isDosBuiltin(commandToken(text)) &&
    (/\.bat$/i.test(token) || resolveBatchTarget(token, path, projectFiles))
  ) {
    return {
      type: "batch-transfer",
      target: token,
      args: args.slice(1),
    };
  }
  if (text.includes("|")) return { type: "pipeline" };
  if (commandToken(text) === "choice") return { type: "choice" };
  if (token && !isDosBuiltin(commandToken(text))) return { type: "external" };
  return { type: "command", command: commandToken(text) };
}

function producesOutcome(info) {
  return ["choice", "external", "pipeline"].includes(info.type);
}

function outcomeRequestKey(parsed, block, kind) {
  return JSON.stringify([
    parsed.fileId || parsed.path,
    block.id,
    kind,
    stripCommandPrefix(block.raw).trim(),
  ]);
}

export function collectOutcomeRequests(parsed, projectFiles = {}) {
  const requests = [];
  parsed.blocks.forEach((block, index) => {
    const next = nextMeaningfulBlock(parsed.blocks, index + 1);
    if (!next || next.kind !== "if" || next.data.type !== "errorlevel") return;

    if (
      block.kind === "external" ||
      block.kind === "pipeline" ||
      (block.kind === "command" && block.data.command === "choice")
    ) {
      requests.push({
        key: outcomeRequestKey(parsed, block, "command"),
        blockId: block.id,
        line: block.line,
        source: block.kind === "command" ? block.data.command : block.kind,
        conditional: false,
      });
      return;
    }

    if (block.kind === "if" && block.data.action) {
      const info = actionInfo(block.data.action, parsed.path, projectFiles);
      if (producesOutcome(info)) {
        requests.push({
          key: outcomeRequestKey(parsed, block, "conditional-action"),
          blockId: block.id,
          line: block.line,
          source: info.type,
          conditional: true,
        });
      }
    }
  });
  return requests;
}

function traceRow(block, event, result = "", text = block.raw, extra = {}) {
  return {
    blockId: block.id,
    file: extra.file,
    line: block.line + 1,
    text,
    event,
    result,
  };
}

export function simulate(parsed, scenario = {}, options = {}) {
  const projectFiles = options.projectFiles || {};
  const maxSteps = options.maxSteps ?? 1000;
  const maxVisits = options.maxVisits ?? 100;
  const variables = Object.fromEntries(
    Object.entries(scenario.variables || {}).map(([name, value]) => [
      norm(name),
      norm(name) === "config" ? String(value).toLowerCase() : value,
    ]),
  );
  const environment = {
    variables,
    paths: { ...(scenario.paths || {}) },
    outcomes: { ...(scenario.outcomes || {}) },
    errorlevel: scenario.errorlevel ?? null,
  };
  const labelIndex = {};
  parsed.blocks.forEach((block, index) => {
    if (block.kind === "label") labelIndex[norm(block.data.label)] = index;
  });
  const outcomeRequests = new Map(
    collectOutcomeRequests(parsed, projectFiles).map((request) => [
      request.key,
      request,
    ]),
  );
  const trace = [];
  const visits = {};
  let programCounter = 0;
  let steps = 0;
  let status = "completed";
  let stop = "Completed";

  const jump = (target, block) => {
    const expanded = expand(target, environment.variables).replace(/^:/, "");
    const event = block?.kind === "goto" ? "jump" : "branch";
    const source = block?.kind === "goto" ? block.raw : `↳ GOTO ${target}`;
    if (expanded.includes("%")) {
      status = "input-required";
      stop = `Input required for GOTO ${expanded}`;
      if (block) {
        trace.push(
          traceRow(block, event, "GOTO target requires input", source, {
            file: parsed.path,
          }),
        );
      }
      return false;
    }
    if (!expanded || labelIndex[norm(expanded)] === undefined) {
      status = "terminated";
      stop = expanded
        ? `Batch terminated: label not found (${expanded})`
        : "Batch terminated: GOTO label missing";
      if (block) {
        trace.push(
          traceRow(
            block,
            event,
            expanded
              ? `Label not found: ${expanded}; batch terminated`
              : "Required GOTO label missing; batch terminated",
            source,
            { file: parsed.path },
          ),
        );
      }
      return false;
    }
    programCounter = labelIndex[norm(expanded)];
    if (block) {
      trace.push(
        traceRow(block, event, `Jump to :${expanded}`, source, {
          file: parsed.path,
        }),
      );
    }
    return true;
  };

  const applyOutcome = (key, block, source, event = "external") => {
    const configured = environment.outcomes[key];
    if (
      configured === undefined ||
      !Number.isInteger(Number(configured)) ||
      Number(configured) < 0 ||
      Number(configured) > 255
    ) {
      trace.push(
        traceRow(
          block,
          event,
          "ERRORLEVEL input required for following branch",
          source,
          { file: parsed.path },
        ),
      );
      status = "input-required";
      stop = `External outcome required at line ${block.line + 1}`;
      return false;
    }
    environment.errorlevel = Number(configured);
    trace.push(
      traceRow(
        block,
        event,
        `Simulated ERRORLEVEL ${environment.errorlevel}`,
        source,
        { file: parsed.path },
      ),
    );
    return true;
  };

  const executeAction = (block, action) => {
    const info = actionInfo(action, parsed.path, projectFiles);
    if (info.type === "goto")
      return jump(info.target, block) ? "jumped" : "stopped";
    if (info.type === "set") {
      const value = expand(info.value, environment.variables);
      environment.variables[norm(info.name)] = value;
      trace.push(
        traceRow(block, "branch", `%${info.name}%=${value}`, `↳ ${action}`, {
          file: parsed.path,
        }),
      );
      return "continued";
    }
    if (info.type === "exit") {
      trace.push(
        traceRow(block, "branch", "Exited interpreter", `↳ ${action}`, {
          file: parsed.path,
        }),
      );
      status = "exited";
      stop = "Exited interpreter";
      return "stopped";
    }
    if (info.type === "call" || info.type === "batch-transfer") {
      const targetPath = resolveBatchTarget(
        info.target,
        parsed.path,
        projectFiles,
      );
      trace.push(
        traceRow(
          block,
          info.type === "call" ? "call" : "transfer",
          targetPath
            ? `${info.type === "call" ? "Call" : "Transfer to"} ${targetPath}`
            : `Unresolved batch file ${info.target}`,
          `↳ ${action}`,
          { file: parsed.path },
        ),
      );
      if (!targetPath) {
        status = "unresolved";
        stop = `Unresolved batch file ${info.target}`;
        return "stopped";
      }
      if (info.type === "batch-transfer") {
        status = "transferred";
        stop = `Transferred execution to ${targetPath}`;
        return "stopped";
      }
      return "continued";
    }
    const conditionalOutcomeKey = outcomeRequestKey(
      parsed,
      block,
      "conditional-action",
    );
    if (producesOutcome(info) && outcomeRequests.has(conditionalOutcomeKey)) {
      return applyOutcome(conditionalOutcomeKey, block, `↳ ${action}`, "branch")
        ? "continued"
        : "stopped";
    }
    trace.push(
      traceRow(block, "branch", "Would execute", `↳ ${action}`, {
        file: parsed.path,
      }),
    );
    return "continued";
  };

  while (programCounter < parsed.blocks.length && steps < maxSteps) {
    const block = parsed.blocks[programCounter];
    steps += 1;
    visits[block.id] = (visits[block.id] || 0) + 1;
    if (visits[block.id] > maxVisits) {
      status = "probable-loop";
      stop = "Probable loop detected";
      break;
    }

    if (block.kind === "blank" || block.kind === "comment") {
      programCounter += 1;
      continue;
    }
    if (block.kind === "label") {
      trace.push(
        traceRow(block, "label", `Entered :${block.data.label}`, block.raw, {
          file: parsed.path,
        }),
      );
      programCounter += 1;
      continue;
    }
    if (block.kind === "set" && block.data.name) {
      const value = expand(block.data.value, environment.variables);
      environment.variables[norm(block.data.name)] = value;
      trace.push(
        traceRow(block, "command", `%${block.data.name}%=${value}`, block.raw, {
          file: parsed.path,
        }),
      );
      programCounter += 1;
      continue;
    }
    if (block.kind === "goto") {
      if (!jump(block.data.target, block)) break;
      continue;
    }
    if (block.kind === "if") {
      const result = evaluateIf(block.data, environment);
      const conditionResult =
        block.data.type === "errorlevel" && environment.errorlevel !== null
          ? `${result ? "TRUE" : "FALSE"} · ${
              block.data.negated ? "NOT (" : ""
            }ERRORLEVEL ${environment.errorlevel} >= ${block.data.level}${
              block.data.negated ? ")" : ""
            }`
          : result === null
            ? "Unresolved"
            : result
              ? "TRUE"
              : "FALSE";
      trace.push(
        traceRow(block, "condition", conditionResult, block.raw, {
          file: parsed.path,
        }),
      );
      if (result === null) {
        status = "input-required";
        stop = `Input required at line ${block.line + 1}`;
        break;
      }
      if (result && block.data.action) {
        const actionResult = executeAction(block, block.data.action.trim());
        if (actionResult === "jumped") continue;
        if (actionResult === "stopped") break;
      }
      programCounter += 1;
      continue;
    }
    if (block.kind === "call" || block.kind === "batch-transfer") {
      const targetPath = resolveBatchTarget(
        block.data.target,
        parsed.path,
        projectFiles,
      );
      trace.push(
        traceRow(
          block,
          block.kind === "call" ? "call" : "transfer",
          targetPath
            ? `${block.kind === "call" ? "Call" : "Transfer to"} ${targetPath}`
            : `Unresolved batch file ${block.data.target}`,
          block.raw,
          { file: parsed.path },
        ),
      );
      if (!targetPath) {
        status = "unresolved";
        stop = `Unresolved batch file ${block.data.target}`;
        break;
      }
      if (block.kind === "batch-transfer") {
        status = "transferred";
        stop = `Transferred execution to ${targetPath}`;
        break;
      }
      programCounter += 1;
      continue;
    }
    if (
      block.kind === "pipeline" ||
      block.kind === "external" ||
      (block.kind === "command" && block.data.command === "choice")
    ) {
      const commandOutcomeKey = outcomeRequestKey(parsed, block, "command");
      if (outcomeRequests.has(commandOutcomeKey)) {
        if (!applyOutcome(commandOutcomeKey, block, block.raw)) break;
      } else {
        trace.push(
          traceRow(
            block,
            block.kind === "command" ? "command" : "external",
            "Would execute; result does not affect modeled flow",
            block.raw,
            { file: parsed.path },
          ),
        );
      }
      programCounter += 1;
      continue;
    }
    if (block.kind === "command" && block.data.command === "exit") {
      trace.push(
        traceRow(block, "command", "Exited interpreter", block.raw, {
          file: parsed.path,
        }),
      );
      status = "exited";
      stop = "Exited interpreter";
      break;
    }
    trace.push(
      traceRow(block, "command", "Would execute", block.raw, {
        file: parsed.path,
      }),
    );
    programCounter += 1;
  }

  if (
    programCounter < parsed.blocks.length &&
    steps >= maxSteps &&
    status === "completed"
  ) {
    status = "step-limit";
    stop = `Step limit reached (${maxSteps})`;
  }

  return {
    trace,
    status,
    stop,
    steps,
    environment,
    revision: options.revision ?? null,
  };
}
