const BUILTINS = new Set([
  "break",
  "call",
  "cd",
  "chdir",
  "choice",
  "cls",
  "copy",
  "ctty",
  "date",
  "del",
  "deltree",
  "dir",
  "echo",
  "erase",
  "exit",
  "for",
  "goto",
  "if",
  "lh",
  "loadhigh",
  "lock",
  "md",
  "mkdir",
  "path",
  "pause",
  "prompt",
  "rd",
  "rem",
  "ren",
  "rename",
  "rmdir",
  "set",
  "shift",
  "time",
  "type",
  "unlock",
  "ver",
  "verify",
  "vol",
]);

export const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export function stripPrefix(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "");
}

export function splitArgs(value) {
  const args = [];
  for (const match of String(value).matchAll(/"([^"]*)"|(\S+)/g)) {
    args.push(match[1] ?? match[2]);
  }
  return args;
}

export function expand(value, environment = {}) {
  return String(value).replace(/%([^%]+)%/g, (match, name) => {
    const key = norm(name);
    return Object.hasOwn(environment, key) ? environment[key] : match;
  });
}

function commandToken(value) {
  const token = (stripPrefix(value).match(/^\S+/) || [""])[0].toLowerCase();
  return /^echo(?:[.:;,=/[]|$)/i.test(token) ? "echo" : token;
}

export function parseIf(value) {
  let rest = stripPrefix(value).replace(/^if\s+/i, "");
  let negated = false;
  if (/^not\s+/i.test(rest)) {
    negated = true;
    rest = rest.replace(/^not\s+/i, "");
  }

  let match = rest.match(/^errorlevel\s+(\d+)\s+(.+)$/i);
  if (match) {
    return {
      type: "errorlevel",
      negated,
      level: Number(match[1]),
      action: match[2],
    };
  }
  match = rest.match(/^exist\s+("([^"]*)"|(\S+))\s+(.+)$/i);
  if (match) {
    return {
      type: "exist",
      negated,
      operand: match[2] ?? match[3],
      action: match[4],
    };
  }
  match = rest.match(/^(.+?)==(.+?)\s+(.+)$/);
  if (match) {
    return {
      type: "compare",
      negated,
      left: match[1],
      right: match[2],
      action: match[3],
    };
  }
  return { type: "unsupported", negated, expression: rest, action: "" };
}

function parseFor(value) {
  const match = stripPrefix(value).match(
    /^for\s+%%?([a-z])\s+in\s+\((.*?)\)\s+do\s+(.+)$/i,
  );
  if (!match) return null;
  return {
    variable: match[1],
    values: splitArgs(match[2]),
    source: match[2],
    action: match[3],
    wildcard: /[*?]/.test(match[2]),
  };
}

function parseChoice(value) {
  const match = stripPrefix(value).match(/(?:^|\s)\/c:?([^\s]+)(?:\s|$)/i);
  return { choices: [...(match?.[1] || "YN")] };
}

export function parseCommand(value) {
  const raw = String(value ?? "");
  const text = stripPrefix(raw);
  const token = commandToken(text);

  if (!text) return { kind: "blank", data: {} };
  if (/^(?:rem(?:\s|$)|::)/i.test(text)) {
    return { kind: "comment", data: {} };
  }
  if (/^:[^:]/.test(text)) {
    return { kind: "label", data: { label: text.slice(1).trim() } };
  }
  if (/^if\s+/i.test(text)) return { kind: "if", data: parseIf(text) };
  if (/^for\s+/i.test(text)) {
    const parsed = parseFor(text);
    return parsed
      ? { kind: "for", data: parsed }
      : { kind: "unsupported", data: { reason: "Malformed FOR command" } };
  }

  let match = text.match(/^set\s+([^=\s]+)=(.*)$/i);
  if (match) {
    return { kind: "set", data: { name: match[1], value: match[2] } };
  }
  match = text.match(/^goto(?:\s+(.*))?$/i);
  if (match) return { kind: "goto", data: { target: match[1] || "" } };
  match = text.match(/^call\s+(.+)$/i);
  if (match) {
    const args = splitArgs(match[1]);
    return {
      kind: "call",
      data: { target: args[0] || "", args: args.slice(1) },
    };
  }
  match = text.match(/^command(?:\.com)?\s+\/(c|k)\s+(.+)$/i);
  if (match) {
    return {
      kind: match[1].toLowerCase() === "c" ? "shell-call" : "shell-transfer",
      data: { action: match[2] },
    };
  }
  if (/^shift(?:\s|$)/i.test(text)) return { kind: "shift", data: {} };
  if (/^exit(?:\s|$)/i.test(text)) return { kind: "exit", data: {} };
  if (token === "choice") return { kind: "choice", data: parseChoice(text) };
  if (text.includes("|")) {
    return {
      kind: "pipeline",
      data: { stages: text.split("|").map((stage) => stage.trim()) },
    };
  }

  const args = splitArgs(text);
  if (/\.bat$/i.test(args[0] || "")) {
    return {
      kind: "transfer",
      data: { target: args[0], args: args.slice(1) },
    };
  }
  return {
    kind: BUILTINS.has(token) ? "command" : "external",
    data: { command: token, args: args.slice(1) },
  };
}

export function parseBatch(source) {
  const lines = String(source.text ?? "").split("\n");
  const statements = lines.map((raw, line) => ({
    id: `${source.key}:${line + 1}`,
    file: source.path,
    line: line + 1,
    raw,
    ...parseCommand(raw),
  }));
  const labels = new Map();
  const diagnostics = [];

  for (const statement of statements) {
    if (statement.kind === "label") {
      const key = norm(statement.data.label);
      if (!key) {
        diagnostics.push({
          severity: "error",
          line: statement.line,
          message: "Empty label",
        });
      } else if (labels.has(key)) {
        diagnostics.push({
          severity: "error",
          line: statement.line,
          message: `Duplicate label :${statement.data.label}`,
        });
      } else {
        labels.set(key, statement.line);
      }
    }
    if (statement.kind === "unsupported") {
      diagnostics.push({
        severity: "error",
        line: statement.line,
        message: statement.data.reason || "Unsupported control-flow syntax",
      });
    }
    if (/\b(?:set\s+\/a|if\s+\/i|for\s+\/f|%~[a-z0-9])/i.test(statement.raw)) {
      diagnostics.push({
        severity: "error",
        line: statement.line,
        message: "NT cmd.exe syntax is outside the MS-DOS 7.1 profile",
      });
    }
  }

  for (const statement of statements) {
    if (statement.kind !== "goto" || /%[^%]+%/.test(statement.data.target)) {
      continue;
    }
    const target = norm(statement.data.target.replace(/^:/, ""));
    if (!target || !labels.has(target)) {
      diagnostics.push({
        severity: "error",
        line: statement.line,
        message: target
          ? `Label not found: ${statement.data.target}`
          : "GOTO label missing",
      });
    }
  }

  return { source, lines, statements, labels, diagnostics };
}

export function isBuiltin(value) {
  return BUILTINS.has(commandToken(value));
}
