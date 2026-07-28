const DOS_BUILTINS = new Set([
  "echo",
  "cls",
  "pause",
  "choice",
  "copy",
  "del",
  "erase",
  "deltree",
  "ren",
  "rename",
  "format",
  "label",
  "sys",
  "subst",
  "restart",
  "cd",
  "chdir",
  "md",
  "mkdir",
  "rd",
  "rmdir",
  "dir",
  "type",
  "ver",
  "verify",
  "vol",
  "path",
  "prompt",
  "date",
  "time",
  "break",
  "ctty",
  "lh",
  "loadhigh",
  "lock",
  "unlock",
  "truename",
  "exit",
  "set",
  "goto",
  "call",
  "if",
  "rem",
]);

const KNOWN_COMMANDS = {
  echo: "Echo",
  cls: "Clear screen",
  pause: "Pause",
  choice: "Choice",
  copy: "Copy",
  del: "Delete",
  erase: "Delete",
  deltree: "Delete tree",
  ren: "Rename",
  rename: "Rename",
  format: "Format",
  label: "Set volume label",
  sys: "Make bootable",
  subst: "Substitute drive",
  restart: "Restart",
  cd: "Change directory",
  chdir: "Change directory",
  md: "Make directory",
  mkdir: "Make directory",
  rd: "Remove directory",
  rmdir: "Remove directory",
  dir: "Directory listing",
  type: "Display file",
  ver: "DOS version",
  verify: "Verify writes",
  vol: "Volume label",
  path: "Set path",
  prompt: "Set prompt",
  date: "Set date",
  time: "Time",
  break: "Break handling",
  ctty: "Change terminal",
  lh: "Load high",
  loadhigh: "Load high",
  lock: "Lock drive",
  unlock: "Unlock drive",
  truename: "Resolve path",
  exit: "Exit interpreter",
};

export function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function makeOpaqueId(prefix = "id") {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function stripCommandPrefix(line) {
  return String(line ?? "")
    .trim()
    .replace(/^@/, "");
}

export function commandToken(line) {
  const commandText = stripCommandPrefix(line);
  const rawToken = (commandText.match(/^\S+/) || [""])[0].toLowerCase();
  return /^echo(?:[.:;,=/[]|$)/i.test(rawToken) ? "echo" : rawToken;
}

export function parseDosArgs(text) {
  const args = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text ?? "")))) {
    args.push(match[1] ?? match[2]);
  }
  return args;
}

export function detectLineEnding(text) {
  const source = String(text ?? "");
  const crlf = (source.match(/\r\n/g) || []).length;
  const withoutCrlf = source.replace(/\r\n/g, "");
  const lf = (withoutCrlf.match(/\n/g) || []).length;
  const cr = (withoutCrlf.match(/\r/g) || []).length;
  const styles = [crlf && "CRLF", lf && "LF", cr && "CR"].filter(Boolean);
  return styles.length === 0
    ? "NONE"
    : styles.length === 1
      ? styles[0]
      : "MIXED";
}

export function splitSource(text) {
  const source = String(text ?? "");
  return {
    lines: source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"),
    lineEnding: detectLineEnding(source),
    hasFinalNewline: /(?:\r\n|\r|\n)$/.test(source),
  };
}

export function joinSource(lines, lineEnding = "CRLF") {
  const separator =
    lineEnding === "LF" ? "\n" : lineEnding === "CR" ? "\r" : "\r\n";
  return lines.join(separator);
}

function lcsMatches(oldLines, newLines) {
  const oldLength = oldLines.length;
  const newLength = newLines.length;
  if (oldLength * newLength > 4_000_000) {
    const matches = [];
    const length = Math.min(oldLength, newLength);
    for (let index = 0; index < length; index += 1) {
      if (oldLines[index] === newLines[index]) matches.push([index, index]);
    }
    return matches;
  }

  const width = newLength + 1;
  const matrix = new Uint32Array((oldLength + 1) * width);
  for (let oldIndex = oldLength - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLength - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex;
      matrix[offset] =
        oldLines[oldIndex] === newLines[newIndex]
          ? matrix[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(
              matrix[(oldIndex + 1) * width + newIndex],
              matrix[oldIndex * width + newIndex + 1],
            );
    }
  }

  const matches = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLength && newIndex < newLength) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      matches.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (
      matrix[(oldIndex + 1) * width + newIndex] >=
      matrix[oldIndex * width + newIndex + 1]
    ) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return matches;
}

export function reconcileLineIds(
  oldLines,
  oldIds,
  newLines,
  makeId = () => makeOpaqueId("line"),
) {
  const usableOldIds = oldLines.map((_, index) => oldIds[index] || makeId());
  const result = new Array(newLines.length);
  const matches = lcsMatches(oldLines, newLines);
  const anchors = [[-1, -1], ...matches, [oldLines.length, newLines.length]];

  for (const [oldIndex, newIndex] of matches) {
    result[newIndex] = usableOldIds[oldIndex];
  }

  for (
    let anchorIndex = 0;
    anchorIndex < anchors.length - 1;
    anchorIndex += 1
  ) {
    const [oldBefore, newBefore] = anchors[anchorIndex];
    const [oldAfter, newAfter] = anchors[anchorIndex + 1];
    const oldStart = oldBefore + 1;
    const newStart = newBefore + 1;
    const pairCount = Math.min(oldAfter - oldStart, newAfter - newStart);
    for (let offset = 0; offset < pairCount; offset += 1) {
      result[newStart + offset] = usableOldIds[oldStart + offset];
    }
    for (
      let newIndex = newStart + pairCount;
      newIndex < newAfter;
      newIndex += 1
    ) {
      result[newIndex] = makeId();
    }
  }

  return result.map((id) => id || makeId());
}

export function normalizeProjectPath(path) {
  const parts = [];
  for (const part of String(path ?? "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

export function cleanBatchReference(target) {
  return parseDosArgs(String(target ?? "").trim())[0] || "";
}

export function resolveBatchTarget(target, callerPath, projectFiles = {}) {
  const rawTarget = String(target ?? "").trim();
  const unquotedTarget = rawTarget.match(/^"([^"]+)"(?:\s|$)/)?.[1];
  const reference =
    unquotedTarget ||
    (/\.bat$/i.test(rawTarget) ? rawTarget : cleanBatchReference(rawTarget));
  if (!reference || /%[^%]+%/.test(reference)) return null;
  const files = Object.keys(projectFiles);
  const callerDirectory = String(callerPath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .join("/");
  const normalizedReference = reference.replace(/\\/g, "/");
  const qualified = /[\\/]/.test(reference) || /^[a-z]:/i.test(reference);
  const hasExtension = /\.[^/\\]+$/.test(reference);
  const references = hasExtension
    ? [reference]
    : [reference, `${reference}.BAT`];
  const candidates = [];

  for (const item of references) {
    const normalized = item.replace(/\\/g, "/");
    if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("/")) {
      candidates.push(normalized.replace(/^[a-z]:\//i, "").replace(/^\//, ""));
    } else {
      if (callerDirectory) candidates.push(`${callerDirectory}/${normalized}`);
      candidates.push(normalized);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeProjectPath(candidate);
    const hit = files.find((file) => normalizeProjectPath(file) === normalized);
    if (hit && /\.bat$/i.test(hit)) return hit;
  }

  if (qualified) return null;
  const basename = normalizeProjectPath(normalizedReference).split("/").pop();
  const basenameWithExtension = /\.bat$/i.test(basename)
    ? basename
    : `${basename}.bat`;
  const matches = files.filter(
    (file) =>
      normalizeProjectPath(file).split("/").pop() === basenameWithExtension,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function resolveRenameDestination(source, destination) {
  if (!source || !destination) return "";
  if (/^[a-z]:\\|^[\\/]|[\\/]/i.test(destination)) return "";
  const index = Math.max(source.lastIndexOf("\\"), source.lastIndexOf("/"));
  return index >= 0 ? source.slice(0, index + 1) + destination : destination;
}

export function parseIf(line) {
  let rest = stripCommandPrefix(line).replace(/^if\s+/i, "");
  let negated = false;
  if (/^not\s+/i.test(rest)) {
    negated = true;
    rest = rest.replace(/^not\s+/i, "");
  }
  let match = rest.match(/^exist\s+("([^"]*)"|(\S+))\s+(.+)$/i);
  if (match) {
    return {
      type: "exist",
      negated,
      operand: match[2] ?? match[3],
      action: match[4],
    };
  }
  match = rest.match(/^errorlevel\s+(\d+)\s+(.+)$/i);
  if (match) {
    return {
      type: "errorlevel",
      negated,
      level: Number(match[1]),
      action: match[2],
    };
  }
  match = rest.match(/^(.+?)==(.+?)\s+(.+)$/i);
  if (match) {
    return {
      type: "compare",
      negated,
      left: match[1],
      right: match[2],
      action: match[3],
    };
  }
  return { type: "raw", negated, expression: rest };
}

function findVariables(text) {
  const found = new Map();
  for (const match of String(text).matchAll(/%([^%]+)%/g)) {
    if (!/^\d$/.test(match[1])) {
      found.set(norm(match[1]), { name: match[1], values: new Set() });
    }
  }
  for (const match of String(text).matchAll(
    /if\s+%([^%]+)%==([^\s]+)|if\s+([^\s=]+)==%([^%]+)%/gi,
  )) {
    const name = match[1] || match[4];
    const value = match[2] || match[3];
    if (name && found.has(norm(name))) found.get(norm(name)).values.add(value);
  }
  return [...found.values()].map((item) => ({
    name: item.name,
    values: [...item.values],
  }));
}

function findExistPaths(text) {
  const paths = new Set();
  for (const match of String(text).matchAll(
    /if\s+(?:not\s+)?exist\s+("[^"]*"|[^\s]+)/gi,
  )) {
    paths.add(match[1].replace(/^"|"$/g, ""));
  }
  return [...paths];
}

export function parseConfigSys(text, path) {
  const { lines } = splitSource(text);
  const sections = new Map();
  let current = "";
  const menuItems = [];
  let menuDefault = "";
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = norm(sectionMatch[1]);
      if (!sections.has(current)) {
        sections.set(current, {
          name: sectionMatch[1],
          line: index,
          lines: [],
        });
      }
      return;
    }
    if (!sections.has(current)) {
      sections.set(current, { name: current || "GLOBAL", line: 0, lines: [] });
    }
    sections.get(current).lines.push({ raw, line: index });
    if (current === "menu") {
      const itemMatch = trimmed.match(/^menuitem\s*=\s*([^,\s]+)(?:\s*,.*)?$/i);
      if (
        itemMatch &&
        !menuItems.some((item) => norm(item) === norm(itemMatch[1]))
      ) {
        menuItems.push(itemMatch[1]);
      }
      const defaultMatch = trimmed.match(/^menudefault\s*=\s*([^,\s]+)/i);
      if (defaultMatch) menuDefault = defaultMatch[1];
    }
  });
  return { path, sections, menuItems, menuDefault };
}

export function getProjectConfigInfo(projectFiles = {}) {
  const path = Object.keys(projectFiles).find((file) =>
    /(^|[\\/])config\.sys$/i.test(file),
  );
  return path ? parseConfigSys(projectFiles[path].content, path) : null;
}

function isDirectBatchInvocation(line, path, projectFiles) {
  const text = stripCommandPrefix(line);
  const token = parseDosArgs(text)[0] || "";
  if (!token || DOS_BUILTINS.has(commandToken(text))) return false;
  return (
    /\.bat$/i.test(token) ||
    Boolean(resolveBatchTarget(token, path, projectFiles))
  );
}

function validate(blocks, labels, configInfo, path, projectFiles) {
  const validations = [];
  const declared = new Map();
  for (const block of blocks) {
    if (block.kind !== "label") continue;
    const key = norm(block.data.label);
    if (declared.has(key)) {
      validations.push({
        severity: "error",
        message: `Duplicate label :${block.data.label}`,
        blockId: block.id,
      });
    } else {
      declared.set(key, block);
    }
  }

  for (const block of blocks) {
    if (
      block.kind === "goto" &&
      !block.data.target.includes("%") &&
      !labels.has(norm(block.data.target.replace(/^:/, "")))
    ) {
      validations.push({
        severity: "error",
        message: `Unresolved GOTO ${block.data.target}`,
        blockId: block.id,
      });
    }
    if (
      ["call", "batch-transfer"].includes(block.kind) &&
      !/%[^%]+%/.test(block.data.target || "") &&
      !resolveBatchTarget(block.data.target, path, projectFiles)
    ) {
      validations.push({
        severity: "warn",
        message: `Unresolved batch file ${block.data.target}`,
        blockId: block.id,
      });
    }
    if (
      block.kind === "if" &&
      block.data.type === "compare" &&
      /%[^%]+%/.test(block.raw) &&
      !/["']%[^%]+%["']/.test(block.raw)
    ) {
      validations.push({
        severity: "warn",
        message:
          "Unquoted variable comparison may become malformed when empty.",
        blockId: block.id,
      });
    }
    if (/goto\s+:?eof/i.test(block.raw)) {
      validations.push({
        severity: "error",
        message: "GOTO :EOF is not supported by Win98 COMMAND.COM.",
        blockId: block.id,
      });
    }
    if (/\b(?:set\s+\/a|if\s+\/i|for\s+\/f|%~[a-z0-9])/i.test(block.raw)) {
      validations.push({
        severity: "error",
        message: "NT CMD.EXE syntax detected.",
        blockId: block.id,
      });
    }
    if (/^::/.test(stripCommandPrefix(block.raw))) {
      validations.push({
        severity: "warn",
        message: ":: is a pseudo-comment, not the documented REM command.",
        blockId: block.id,
      });
    }
    if (block.kind === "goto" && /%config%/i.test(block.data.target || "")) {
      if (!configInfo) {
        validations.push({
          severity: "warn",
          message:
            "Dynamic GOTO %config% cannot be validated until CONFIG.SYS is loaded.",
          blockId: block.id,
        });
      } else {
        for (const item of configInfo.menuItems) {
          if (!labels.has(norm(item))) {
            validations.push({
              severity: "error",
              message: `CONFIG.SYS menu item ${item} has no matching :${item} label.`,
              blockId: block.id,
            });
          }
        }
        if (!configInfo.menuItems.length) {
          validations.push({
            severity: "warn",
            message:
              "CONFIG.SYS contains no [MENU] MENUITEM values for %config%.",
            blockId: block.id,
          });
        }
      }
    }
  }
  return validations;
}

export function parseBatch(text, path, options = {}) {
  const { lines } = splitSource(text);
  const projectFiles = options.projectFiles || {};
  const lineIds = reconcileLineIds(
    [],
    [],
    lines,
    options.makeId || (() => makeOpaqueId("line")),
  ).map((generated, index) => options.lineIds?.[index] || generated);
  const blocks = [];
  const labels = new Map();
  const sections = [];
  let section = {
    id: `section:${lineIds[0] || makeOpaqueId("section")}`,
    labels: [],
    labelBlocks: [],
    blocks: [],
  };
  sections.push(section);

  lines.forEach((raw, index) => {
    const id = lineIds[index];
    const trimmed = raw.trim();
    const commandText = stripCommandPrefix(trimmed);
    let kind;
    let data = {};
    let title;

    if (!commandText) {
      kind = "blank";
      title = "Blank line";
    } else if (/^rem(?:\s|$)/i.test(commandText) || /^::/.test(commandText)) {
      kind = "comment";
      title = /^::/.test(commandText) ? "Pseudo-comment" : "Comment";
    } else if (/^:[^:]/.test(commandText)) {
      kind = "label";
      title = "Label";
      data.label = commandText.slice(1).trim();
      if (section.blocks.length) {
        section = {
          id: `section:${id}`,
          labels: [],
          labelBlocks: [],
          blocks: [],
        };
        sections.push(section);
      }
      section.labels.push(data.label);
      section.labelBlocks.push(id);
      labels.set(norm(data.label), {
        line: index,
        sectionId: section.id,
        blockId: id,
      });
    } else if (/^set\s+/i.test(commandText)) {
      kind = "set";
      title = "Set variable";
      const match = commandText.match(/^set\s+([^=\s]+)=(.*)$/i);
      if (match) data = { name: match[1], value: match[2] };
    } else if (/^goto(?:\s|$)/i.test(commandText)) {
      kind = "goto";
      title = "Jump";
      data.target = commandText.replace(/^goto(?:\s+|$)/i, "").trim();
    } else if (/^call\s+/i.test(commandText)) {
      kind = "call";
      title = "Call batch";
      const remainder = commandText.replace(/^call\s+/i, "").trim();
      const args = parseDosArgs(remainder);
      data.target = args[0] || "";
      data.args = args.slice(1);
      data.returns = true;
    } else if (isDirectBatchInvocation(commandText, path, projectFiles)) {
      kind = "batch-transfer";
      title = "Run batch (no return)";
      const args = parseDosArgs(commandText);
      data.target = args[0] || "";
      data.args = args.slice(1);
      data.returns = false;
    } else if (/^if\s+/i.test(commandText)) {
      kind = "if";
      title = "Condition";
      data = parseIf(commandText);
    } else if (commandText.includes("|")) {
      kind = "pipeline";
      title = "Pipeline";
      data.stages = commandText.split("|").map((stage) => stage.trim());
    } else {
      const rawToken = (commandText.match(/^\S+/) || [""])[0].toLowerCase();
      const first = commandToken(commandText);
      if (KNOWN_COMMANDS[first]) {
        kind = "command";
        title = KNOWN_COMMANDS[first];
      } else {
        kind = "external";
        title = `External: ${rawToken || "command"}`;
      }
      data.command = first;
      data.rawCommandToken = rawToken;
      if (first === "echo") {
        data.echoMode = /^echo[.:;,=/[]/i.test(rawToken)
          ? "blank-line-form"
          : "normal";
      }
      if (first === "ren" || first === "rename") {
        const args = parseDosArgs(commandText.slice(rawToken.length).trim());
        data.source = args[0] || "";
        data.destination = args[1] || "";
        data.resolvedDestination = resolveRenameDestination(
          data.source,
          data.destination,
        );
        data.destinationHasPath = Boolean(
          data.destination && !data.resolvedDestination,
        );
      }
    }

    const block = { id, line: index, raw, kind, title, data };
    blocks.push(block);
    if (kind !== "label") section.blocks.push(block);
  });

  const configInfo = options.configInfo ?? getProjectConfigInfo(projectFiles);
  const variables = findVariables(text);
  if (configInfo) {
    const configVariable = variables.find(
      (item) => norm(item.name) === "config",
    );
    if (configVariable) {
      const menuKeys = new Set(
        configInfo.menuItems.map((value) => norm(value)),
      );
      configVariable.values = [
        ...configInfo.menuItems,
        ...configVariable.values.filter((value) => !menuKeys.has(norm(value))),
      ];
    }
  }

  return {
    path,
    fileId: options.fileId || null,
    text,
    lines,
    lineIds,
    blocks,
    labels,
    sections,
    variables,
    paths: findExistPaths(text),
    validations: validate(blocks, labels, configInfo, path, projectFiles),
    configInfo,
  };
}

export function nextMeaningfulBlock(blocks, startIndex) {
  for (let index = startIndex; index < blocks.length; index += 1) {
    if (!["blank", "comment", "label"].includes(blocks[index].kind)) {
      return blocks[index];
    }
  }
  return null;
}

export function expand(value, variables) {
  return String(value ?? "").replace(/%([^%]+)%/g, (match, name) =>
    Object.hasOwn(variables, norm(name)) ? variables[norm(name)] : match,
  );
}

export function normalizeDosPath(path) {
  return String(path ?? "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

export function evaluateIf(condition, environment) {
  let result = null;
  if (condition.type === "exist") {
    const path = normalizeDosPath(
      expand(condition.operand, environment.variables),
    );
    result =
      environment.paths[path] === "yes"
        ? true
        : environment.paths[path] === "no"
          ? false
          : null;
  } else if (condition.type === "errorlevel") {
    result =
      environment.errorlevel == null
        ? null
        : environment.errorlevel >= condition.level;
  } else if (condition.type === "compare") {
    const left = expand(condition.left, environment.variables);
    const right = expand(condition.right, environment.variables);
    result = left.includes("%") || right.includes("%") ? null : left === right;
  }
  return result !== null && condition.negated ? !result : result;
}

export function isDosBuiltin(token) {
  return DOS_BUILTINS.has(norm(token));
}
