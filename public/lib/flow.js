import { norm, parseBatch, parseCommand } from "./batch.js?v=0.6.3";
import {
  configExecution,
  menuDefault,
  menuLeaves,
  parseConfig,
} from "./config.js?v=0.6.3";
import { pathKey } from "./source.js?v=0.6.3";

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

const NONLINEAR_ROLES = new Set([
  "call",
  "case",
  "jump",
  "loop",
  "return",
  "transfer",
]);
const NONLINEAR_ACTIONS = new Set([
  "call",
  "exit",
  "goto",
  "shell-call",
  "shell-transfer",
  "transfer",
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

function edge(
  from,
  to,
  role = "next",
  label = "",
  nonlinear = NONLINEAR_ROLES.has(role),
) {
  return { id: `${from}->${to}:${role}`, from, to, role, label, nonlinear };
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
      lineNumbers: process.map((statement) => statement.line),
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
      lineNumbers: [statement.line],
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
      const actionKind = parseCommand(statement.data.action).kind;
      const actionTarget = targetForAction(
        statement.data.action,
        labelNodes,
        endId,
      );
      edges.push(
        edge(
          node.id,
          actionTarget || nextId,
          "true",
          "True",
          NONLINEAR_ACTIONS.has(actionKind),
        ),
      );
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

function batchReference(node) {
  if (["call", "transfer"].includes(node.statementKind)) {
    return { kind: node.statementKind, target: node.data.target };
  }
  if (["shell-call", "shell-transfer"].includes(node.statementKind)) {
    const parsed = parseCommand(node.data.action);
    if (["call", "transfer"].includes(parsed.kind)) {
      return {
        kind: node.statementKind === "shell-call" ? "call" : "transfer",
        target: parsed.data.target,
      };
    }
  }
  return null;
}

function actionReference(node) {
  const action =
    node.kind === "decision" || node.kind === "loop" ? node.data.action : "";
  if (!action) return null;
  const parsed = parseCommand(action);
  return ["call", "transfer"].includes(parsed.kind)
    ? { kind: parsed.kind, target: parsed.data.target }
    : null;
}

export function resolveBatchTarget(target, callerPath, sources) {
  const raw = String(target ?? "").trim();
  const reference = splitTarget(raw);
  if (!reference || /%[^%]+%/.test(reference)) return "";
  const normalized = reference.replace(/\\/g, "/");
  const qualified = /[\\/]/.test(reference) || /^[a-z]:/i.test(reference);
  const callerDirectory = String(callerPath)
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .join("/");
  const variants = /\.[^/]+$/i.test(normalized)
    ? [normalized]
    : [normalized, `${normalized}.BAT`];
  const candidates = [];
  for (const variant of variants) {
    const withoutDrive = variant.replace(/^[a-z]:\//i, "").replace(/^\//, "");
    if (
      callerDirectory &&
      !/^[a-z]:\//i.test(variant) &&
      !variant.startsWith("/")
    ) {
      candidates.push(pathKey(`${callerDirectory}/${variant}`));
    }
    candidates.push(pathKey(withoutDrive));
  }
  for (const candidate of candidates) {
    if (sources.has(candidate) && /\.bat$/i.test(candidate)) return candidate;
  }
  if (qualified) return "";
  const basename = pathKey(variants.at(-1)).split("/").pop();
  const matches = [...sources.keys()].filter(
    (key) => /\.bat$/i.test(key) && key.split("/").pop() === basename,
  );
  return matches.length === 1 ? matches[0] : "";
}

function splitTarget(value) {
  const quoted = value.match(/^"([^"]+)"/);
  return quoted?.[1] || value.match(/^\S+/)?.[0] || "";
}

function preferredPath(sources, expression) {
  return [...sources.keys()]
    .filter((key) => expression.test(key))
    .sort((left, right) => {
      const depth = left.split("/").length - right.split("/").length;
      return depth || left.localeCompare(right);
    })[0];
}

function configNode(config, choice) {
  const execution = configExecution(config, choice.key);
  return {
    id: `config:${config.source.key}:${choice.key || "common"}`,
    kind: "config",
    file: config.source.path,
    startLine: 1,
    endLine: config.lines.length,
    lines: execution.lines.map((line) => line.raw),
    lineNumbers: execution.lines.map((line) => line.line),
    labels: [`[${choice.value || "COMMON"}]`],
    data: { config: choice.value || "", key: choice.key || "" },
  };
}

function addMenus(config, nodes, edges, autoexecStart) {
  const leaves = menuLeaves(config);
  const defaultValue = menuDefault(config);
  const added = new Set();

  const add = (key) => {
    const menu = config.menus.get(key);
    if (!menu || added.has(key)) return;
    added.add(key);
    const id = `menu:${config.source.key}:${key}`;
    nodes.push({
      id,
      kind: "menu",
      file: config.source.path,
      startLine: menu.line,
      endLine: menu.line,
      lines: [],
      labels: [`[${menu.name}]`],
      data: {
        key,
        items: menu.items,
        default: menu.default,
        timeout: menu.timeout,
        color: menu.color,
        numlock: menu.numlock,
      },
    });
    for (const item of menu.items) {
      if (item.kind === "submenu") {
        add(item.key);
        edges.push({
          id: `${id}->menu:${config.source.key}:${item.key}:submenu`,
          from: id,
          to: `menu:${config.source.key}:${item.key}`,
          role: "case",
          label: item.text,
          value: item.key,
          nonlinear: true,
        });
      } else {
        const choice = leaves.find((leaf) => leaf.key === item.key) || {
          key: item.key,
          value: item.target,
        };
        const execution = configNode(config, choice);
        if (!nodes.some((node) => node.id === execution.id))
          nodes.push(execution);
        edges.push({
          id: `${id}->${execution.id}:case`,
          from: id,
          to: execution.id,
          role: "case",
          label: item.text,
          value: item.key,
          nonlinear: true,
        });
        if (autoexecStart) {
          edges.push({
            id: `${execution.id}->${autoexecStart}:boot`,
            from: execution.id,
            to: autoexecStart,
            role: "boot",
            label: "AUTOEXEC.BAT",
            config: item.target,
            nonlinear: false,
          });
        }
      }
    }
  };
  add("menu");
  return {
    entryId: `menu:${config.source.key}:menu`,
    defaultConfig: defaultValue,
    choices: leaves,
  };
}

export function buildProgram(sourceValues, requestedEntry = "") {
  const sources =
    sourceValues instanceof Map
      ? sourceValues
      : new Map([...sourceValues].map((source) => [source.key, source]));
  const configKey = preferredPath(sources, /(^|\/)config\.sys$/i);
  const autoexecKey = preferredPath(sources, /(^|\/)autoexec\.bat$/i);
  const entryKey =
    (requestedEntry && sources.has(requestedEntry) && requestedEntry) ||
    autoexecKey ||
    [...sources.keys()].find((key) => /\.bat$/i.test(key)) ||
    "";
  const fileFlows = new Map();
  for (const [key, source] of sources) {
    if (/\.bat$/i.test(key))
      fileFlows.set(key, buildBatchFlow(parseBatch(source)));
  }

  const reachable = new Set();
  const pending = entryKey ? [entryKey] : [];
  while (pending.length) {
    const key = pending.shift();
    if (reachable.has(key) || !fileFlows.has(key)) continue;
    reachable.add(key);
    for (const node of fileFlows.get(key).nodes) {
      for (const reference of [
        batchReference(node),
        actionReference(node),
      ].filter(Boolean)) {
        const target = resolveBatchTarget(
          reference.target,
          sources.get(key).path,
          sources,
        );
        if (target && !reachable.has(target)) pending.push(target);
      }
    }
  }

  const nodes = [];
  const edges = [];
  const diagnostics = [];
  for (const key of reachable) {
    const flow = fileFlows.get(key);
    nodes.push(...flow.nodes);
    edges.push(...flow.edges);
    diagnostics.push(
      ...flow.diagnostics.map((item) => ({
        ...item,
        file: sources.get(key).path,
      })),
    );
  }

  for (const key of reachable) {
    const flow = fileFlows.get(key);
    for (const node of flow.nodes) {
      const direct = batchReference(node);
      const conditional = actionReference(node);
      const reference = direct || conditional;
      if (!reference) continue;
      const targetKey = resolveBatchTarget(
        reference.target,
        sources.get(key).path,
        sources,
      );
      if (!targetKey || !fileFlows.has(targetKey)) {
        diagnostics.push({
          severity: "warning",
          file: node.file,
          line: node.startLine,
          message: `Batch target not loaded: ${reference.target}`,
        });
        continue;
      }
      const targetFlow = fileFlows.get(targetKey);
      const role = reference.kind === "call" ? "call" : "transfer";
      let continuation;
      if (direct) {
        const returnEdge = edges.find(
          (item) => item.from === node.id && item.role === "return",
        );
        continuation = returnEdge?.to || null;
        if (returnEdge) edges.splice(edges.indexOf(returnEdge), 1);
      } else {
        const actionEdge = edges.find(
          (item) =>
            item.from === node.id &&
            item.role === (node.kind === "loop" ? "loop" : "true"),
        );
        continuation = actionEdge?.to || null;
        if (actionEdge) edges.splice(edges.indexOf(actionEdge), 1);
      }
      edges.push({
        id: `${node.id}->${targetFlow.entryId}:${role}`,
        from: node.id,
        to: targetFlow.entryId,
        role,
        label: reference.target,
        nonlinear: true,
      });
      if (reference.kind === "call" && continuation) {
        edges.push({
          id: `${targetFlow.endId}->${continuation}:return:${node.id}`,
          from: targetFlow.endId,
          to: continuation,
          role: "return",
          label: `Return to ${node.file}:${node.startLine}`,
          callSite: node.id,
          nonlinear: true,
        });
      }
    }
  }

  let entryId = fileFlows.get(entryKey)?.entryId || "";
  let config = null;
  let configChoices = [];
  let defaultConfig = "";
  if (configKey && entryKey === autoexecKey) {
    config = parseConfig(sources.get(configKey));
    diagnostics.push(
      ...config.diagnostics.map((item) => ({
        ...item,
        file: config.source.path,
      })),
    );
    if (config.menus.has("menu")) {
      const menu = addMenus(
        config,
        nodes,
        edges,
        fileFlows.get(autoexecKey)?.entryId,
      );
      entryId = menu.entryId;
      configChoices = menu.choices;
      defaultConfig = menu.defaultConfig;
    } else {
      const common = configNode(config, { key: "", value: "" });
      nodes.push(common);
      if (fileFlows.has(autoexecKey)) {
        edges.push({
          id: `${common.id}->${fileFlows.get(autoexecKey).entryId}:boot`,
          from: common.id,
          to: fileFlows.get(autoexecKey).entryId,
          role: "boot",
          label: "AUTOEXEC.BAT",
          config: "",
          nonlinear: false,
        });
      }
      entryId = common.id;
    }
  }

  return {
    entryId,
    nodes,
    edges,
    diagnostics,
    sources,
    fileFlows,
    config,
    configChoices,
    defaultConfig,
  };
}
