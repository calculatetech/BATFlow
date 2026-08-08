import { norm, parseCommand } from "./batch.js?v=0.6.0";

const CONTROL_KINDS = new Set([
  "call",
  "choice",
  "exit",
  "for",
  "goto",
  "if",
  "pipeline",
  "shell-call",
  "shell-transfer",
  "transfer",
  "unsupported",
]);

function nodeKind(statement) {
  return {
    call: "call",
    choice: "outcome",
    exit: "exit",
    for: "loop",
    goto: "jump",
    if: "decision",
    pipeline: "outcome",
    "shell-call": "call",
    "shell-transfer": "transfer",
    transfer: "transfer",
    unsupported: "unsupported",
  }[statement.kind];
}

function edge(from, to, role = "next", label = "") {
  return { id: `${from}->${to}:${role}`, from, to, role, label };
}

function targetForAction(action, labelNodes, endId) {
  const parsed = parseCommand(action);
  if (parsed.kind === "goto") {
    return labelNodes.get(norm(parsed.data.target.replace(/^:/, ""))) || endId;
  }
  if (parsed.kind === "exit") return endId;
  return null;
}

export function buildBatchFlow(parsed) {
  const startId = `start:${parsed.source.key}`;
  const endId = `end:${parsed.source.key}`;
  const nodes = [
    {
      id: startId,
      kind: "start",
      file: parsed.source.path,
      startLine: 0,
      endLine: 0,
      lines: [],
      labels: [],
      data: {},
    },
  ];
  const statementNodes = new Map();
  const pendingLabels = [];
  let process = [];

  const flushProcess = () => {
    if (!process.length) return;
    const first = process[0];
    const last = process.at(-1);
    const node = {
      id: `node:${parsed.source.key}:${first.line}`,
      kind: "process",
      file: parsed.source.path,
      startLine: first.line,
      endLine: last.line,
      lines: process.map((statement) => statement.raw),
      labels: pendingLabels.splice(0),
      statements: process,
      data: {},
    };
    nodes.push(node);
    for (const statement of process)
      statementNodes.set(statement.line, node.id);
    process = [];
  };

  for (const statement of parsed.statements) {
    if (statement.kind === "blank" || statement.kind === "comment") continue;
    if (statement.kind === "label") {
      flushProcess();
      pendingLabels.push(statement.data.label);
      continue;
    }
    if (!CONTROL_KINDS.has(statement.kind)) {
      process.push(statement);
      continue;
    }
    flushProcess();
    const node = {
      id: `node:${parsed.source.key}:${statement.line}`,
      kind: nodeKind(statement),
      file: parsed.source.path,
      startLine: statement.line,
      endLine: statement.line,
      lines: [statement.raw],
      labels: pendingLabels.splice(0),
      statements: [statement],
      data: statement.data,
      statementKind: statement.kind,
    };
    nodes.push(node);
    statementNodes.set(statement.line, node.id);
  }
  flushProcess();

  const endNode = {
    id: endId,
    kind: "end",
    file: parsed.source.path,
    startLine: parsed.lines.length + 1,
    endLine: parsed.lines.length + 1,
    lines: [],
    labels: pendingLabels.splice(0),
    data: {},
  };
  nodes.push(endNode);

  const labelNodes = new Map();
  for (const node of nodes) {
    for (const label of node.labels) labelNodes.set(norm(label), node.id);
  }

  const edges = [];
  if (nodes.length > 2) edges.push(edge(startId, nodes[1].id));
  else edges.push(edge(startId, endId));

  for (let index = 1; index < nodes.length - 1; index += 1) {
    const node = nodes[index];
    const nextId = nodes[index + 1]?.id || endId;
    const statement = node.statements.at(-1);

    if (node.kind === "jump") {
      const target = statement.data.target;
      if (/%[^%]+%/.test(target)) {
        for (const [label, id] of labelNodes) {
          edges.push(edge(node.id, id, "case", `:${label}`));
        }
      } else {
        edges.push(
          edge(
            node.id,
            labelNodes.get(norm(target.replace(/^:/, ""))) || endId,
            "jump",
            target || "missing label",
          ),
        );
      }
      continue;
    }
    if (node.kind === "decision") {
      const actionTarget = targetForAction(
        statement.data.action,
        labelNodes,
        endId,
      );
      edges.push(edge(node.id, actionTarget || nextId, "true", "True"));
      edges.push(edge(node.id, nextId, "false", "False"));
      continue;
    }
    if (node.kind === "loop") {
      const actionTarget = targetForAction(
        statement.data.action,
        labelNodes,
        endId,
      );
      edges.push(edge(node.id, actionTarget || node.id, "loop", "Next item"));
      edges.push(edge(node.id, nextId, "false", "Done"));
      continue;
    }
    if (node.kind === "exit") {
      edges.push(edge(node.id, endId, "exit", "Exit"));
      continue;
    }
    if (node.kind === "transfer") continue;
    edges.push(
      edge(
        node.id,
        nextId,
        node.kind === "call" ? "return" : "next",
        node.kind === "call" ? "Return" : "",
      ),
    );
  }

  return {
    entryId: startId,
    endId,
    nodes,
    edges,
    labelNodes,
    statementNodes,
    diagnostics: parsed.diagnostics,
  };
}
