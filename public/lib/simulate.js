import { expand, norm, parseCommand, splitArgs } from "./batch.js?v=0.6.0";

function setArguments(runtime, values) {
  for (let index = 1; index <= 9; index += 1) {
    delete runtime.environment[String(index)];
  }
  runtime.arguments = values;
  values.slice(0, 9).forEach((value, index) => {
    runtime.environment[String(index + 1)] = value;
  });
}

function decisionResult(node, input, runtime) {
  const condition = node.data;
  let result;
  if (condition.type === "errorlevel") {
    result = Number(input.errorlevel ?? runtime.errorlevel) >= condition.level;
  } else if (condition.type === "exist") {
    result = Boolean(input.exists);
  } else if (condition.type === "compare") {
    const variables = { ...runtime.environment };
    const variable = condition.left.match(/%([^%]+)%/)?.[1];
    if (variable && Object.hasOwn(input, "value")) {
      variables[norm(variable)] = input.value;
    }
    result =
      expand(condition.left, variables) === expand(condition.right, variables);
  } else {
    result = Boolean(input.condition);
  }
  return condition.negated ? !result : result;
}

function nextEdge(node, outgoing, input, runtime, loops, stack) {
  if (node.kind === "menu") {
    const selected = input.selection || node.data.default;
    return outgoing.find((edge) => edge.value === selected) || outgoing[0];
  }
  if (node.kind === "decision") {
    const role = decisionResult(node, input, runtime) ? "true" : "false";
    return outgoing.find((edge) => edge.role === role);
  }
  if (node.kind === "jump" && outgoing.length > 1) {
    return outgoing.find((edge) => edge.to === input.target) || outgoing[0];
  }
  if (node.kind === "loop") {
    const values = node.data.wildcard
      ? String(input.values || "")
          .split(/[\s,]+/)
          .filter(Boolean)
      : node.data.values;
    const count = loops.get(node.id) || 0;
    if (count < values.length) {
      loops.set(node.id, count + 1);
      runtime.environment[norm(node.data.variable)] = values[count];
      return outgoing.find((edge) =>
        ["loop", "call", "transfer"].includes(edge.role),
      );
    }
    loops.delete(node.id);
    return outgoing.find((edge) => edge.role === "false");
  }
  if (node.kind === "end" && stack.length) {
    const frame = stack.pop();
    setArguments(runtime, frame.arguments);
    return outgoing.find((edge) => edge.callSite === frame.callSite);
  }
  return outgoing[0];
}

export function simulate(program, scenario = {}) {
  const nodes = new Map(program.nodes.map((node) => [node.id, node]));
  const edges = new Map(program.nodes.map((node) => [node.id, []]));
  for (const edge of program.edges) edges.get(edge.from)?.push(edge);
  const runtime = { environment: {}, errorlevel: 0, arguments: [] };
  const activeNodes = new Set();
  const activeEdges = new Set();
  const executed = [];
  const loops = new Map();
  const stack = [];
  let current = program.entryId;
  let stop = "Complete";

  for (let steps = 0; current && steps < 1000; steps += 1) {
    const node = nodes.get(current);
    if (!node) break;
    const input = scenario[node.id] || {};
    activeNodes.add(node.id);
    if (node.kind === "start" && (node.id === program.entryId || input.args)) {
      setArguments(runtime, splitArgs(input.args || ""));
    }
    node.lines.forEach((source, index) =>
      executed.push({
        nodeId: node.id,
        file: node.file,
        line: node.startLine + index,
        source,
      }),
    );
    for (const statement of node.statements || []) {
      if (statement.kind === "set") {
        runtime.environment[norm(statement.data.name)] = expand(
          statement.data.value,
          runtime.environment,
        );
      } else if (statement.kind === "shift") {
        setArguments(runtime, runtime.arguments.slice(1));
      } else if (["choice", "external", "pipeline"].includes(statement.kind)) {
        runtime.errorlevel = Number(input.errorlevel ?? input.choice ?? 0);
      }
    }
    if (node.kind === "config") runtime.environment.config = node.data.config;
    const outgoing = edges.get(node.id) || [];
    const selected = nextEdge(node, outgoing, input, runtime, loops, stack);
    if (!selected) {
      if (node.kind !== "end" && node.kind !== "exit") stop = "No path";
      break;
    }
    if (selected.role === "call") {
      stack.push({ callSite: node.id, arguments: [...runtime.arguments] });
      const call = ["call", "shell-call"].includes(node.statementKind)
        ? node.statementKind === "call"
          ? node
          : parseCommand(node.data.action)
        : parseCommand(node.data.action || "");
      setArguments(
        runtime,
        (call.data.args || []).map((value) =>
          expand(value, runtime.environment),
        ),
      );
    }
    if (selected.config !== undefined)
      runtime.environment.config = selected.config;
    activeEdges.add(selected.id);
    current = selected.to;
    if (steps === 999) stop = "Stopped after 1,000 steps";
  }
  return {
    activeNodes,
    activeEdges,
    executed,
    environment: runtime.environment,
    stop,
  };
}
