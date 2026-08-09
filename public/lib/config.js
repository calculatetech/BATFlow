import { norm } from "./batch.js?v=0.6.3";

function parseAssignment(raw) {
  const match = raw.trim().match(/^([^=\s]+)\s*=\s*(.*)$/);
  return match ? { command: norm(match[1]), value: match[2] } : null;
}

function splitPair(value) {
  const comma = value.indexOf(",");
  return comma < 0
    ? [value.trim(), ""]
    : [value.slice(0, comma).trim(), value.slice(comma + 1).trim()];
}

function detectCycles(graph, label, diagnostics) {
  const visited = new Set();
  const active = new Set();

  const visit = (key, trail) => {
    if (active.has(key)) {
      diagnostics.push({
        severity: "error",
        line: 0,
        message: `${label} cycle: ${[...trail, key].join(" → ")}`,
      });
      return;
    }
    if (visited.has(key)) return;
    visited.add(key);
    active.add(key);
    for (const target of graph.get(key) || []) visit(target, [...trail, key]);
    active.delete(key);
  };

  for (const key of graph.keys()) visit(key, []);
}

export function parseConfig(source) {
  const lines = String(source.text ?? "").split("\n");
  const sections = [];
  let current = { name: "COMMON", key: "common", line: 0, lines: [] };
  sections.push(current);

  lines.forEach((raw, index) => {
    const match = raw.trim().match(/^\[([^\]]+)\]$/);
    if (match) {
      current = {
        name: match[1].trim(),
        key: norm(match[1]),
        line: index + 1,
        lines: [],
      };
      sections.push(current);
      return;
    }
    current.lines.push({
      raw,
      line: index + 1,
      assignment: parseAssignment(raw),
    });
  });

  const byKey = new Map();
  const diagnostics = [];
  for (const section of sections) {
    const entries = byKey.get(section.key) || [];
    entries.push(section);
    byKey.set(section.key, entries);
    if (section.key !== "common" && entries.length > 1) {
      diagnostics.push({
        severity: "error",
        line: section.line,
        message: `Duplicate CONFIG.SYS section [${section.name}]`,
      });
    }
  }

  const menus = new Map();
  for (const section of sections) {
    const directives = section.lines
      .filter((line) => line.assignment)
      .map((line) => ({ ...line.assignment, line: line.line, raw: line.raw }));
    const isMenu =
      section.key === "menu" ||
      directives.some((item) => ["menuitem", "submenu"].includes(item.command));
    if (!isMenu) continue;

    const menu = {
      key: section.key,
      name: section.name,
      line: section.line,
      items: [],
      default: "",
      timeout: null,
      color: "",
      numlock: "",
    };
    for (const directive of directives) {
      if (["menuitem", "submenu"].includes(directive.command)) {
        const [target, text] = splitPair(directive.value);
        menu.items.push({
          kind: directive.command,
          target,
          key: norm(target),
          text: text || target,
          line: directive.line,
        });
      } else if (directive.command === "menudefault") {
        const [target, timeout] = splitPair(directive.value);
        menu.default = norm(target);
        menu.timeout = timeout === "" ? null : Number(timeout);
        if (
          timeout !== "" &&
          (!Number.isInteger(menu.timeout) || menu.timeout < 0)
        ) {
          diagnostics.push({
            severity: "error",
            line: directive.line,
            message: "MENUDEFAULT timeout must be a non-negative integer",
          });
        }
      } else if (directive.command === "menucolor") {
        menu.color = directive.value;
      } else if (directive.command === "numlock") {
        menu.numlock = norm(directive.value);
        if (!["on", "off"].includes(menu.numlock)) {
          diagnostics.push({
            severity: "error",
            line: directive.line,
            message: "NUMLOCK must be ON or OFF",
          });
        }
      } else if (!/^(?:rem)?$/i.test(directive.command)) {
        diagnostics.push({
          severity: "error",
          line: directive.line,
          message: `${directive.command.toUpperCase()} is not valid in a menu block`,
        });
      }
    }
    if (menu.items.length > 9) {
      diagnostics.push({
        severity: "error",
        line: menu.line,
        message: `[${menu.name}] exceeds the nine-item DOS menu limit`,
      });
    }
    if (menu.default && !menu.items.some((item) => item.key === menu.default)) {
      diagnostics.push({
        severity: "error",
        line: menu.line,
        message: `MENUDEFAULT target not found in [${menu.name}]: ${menu.default}`,
      });
    }
    menus.set(menu.key, menu);
  }

  const submenuGraph = new Map();
  for (const menu of menus.values()) {
    submenuGraph.set(
      menu.key,
      menu.items
        .filter((item) => item.kind === "submenu")
        .map((item) => item.key),
    );
    for (const item of menu.items) {
      if (item.kind === "submenu" && !menus.has(item.key)) {
        diagnostics.push({
          severity: "error",
          line: item.line,
          message: `SUBMENU section not found: [${item.target}]`,
        });
      }
      if (item.kind === "menuitem" && !byKey.has(item.key)) {
        diagnostics.push({
          severity: "error",
          line: item.line,
          message: `MENUITEM section not found: [${item.target}]`,
        });
      }
    }
  }
  detectCycles(submenuGraph, "SUBMENU", diagnostics);

  const includeGraph = new Map();
  for (const section of sections.filter((item) => !menus.has(item.key))) {
    const includes = section.lines
      .filter((line) => line.assignment?.command === "include")
      .map((line) => norm(line.assignment.value));
    includeGraph.set(section.key, includes);
    for (const key of includes) {
      if (!byKey.has(key)) {
        diagnostics.push({
          severity: "error",
          line: section.line,
          message: `INCLUDE section not found: [${key}]`,
        });
      }
    }
  }
  detectCycles(includeGraph, "INCLUDE", diagnostics);

  return { source, lines, sections, byKey, menus, diagnostics };
}

export function menuDefault(config, menuKey = "menu") {
  const seen = new Set();
  let menu = config.menus.get(norm(menuKey));
  while (menu && !seen.has(menu.key)) {
    seen.add(menu.key);
    const item =
      menu.items.find((candidate) => candidate.key === menu.default) ||
      menu.items[0];
    if (!item) return "";
    if (item.kind === "menuitem") return item.key;
    menu = config.menus.get(item.key);
  }
  return "";
}

export function menuLeaves(config, menuKey = "menu", trail = []) {
  const menu = config.menus.get(norm(menuKey));
  if (!menu || trail.includes(menu.key)) return [];
  return menu.items.flatMap((item) =>
    item.kind === "menuitem"
      ? [
          {
            value: item.target,
            key: item.key,
            text: item.text,
            trail: [...trail, menu.key],
          },
        ]
      : menuLeaves(config, item.key, [...trail, menu.key]),
  );
}

function expandSection(config, key, active, diagnostics) {
  if (active.has(key)) return [];
  const section = config.byKey.get(key)?.[0];
  if (!section) return [];
  return expandSectionRecord(config, section, active, diagnostics);
}

function expandSectionRecord(config, section, active, diagnostics) {
  const key = section.key;
  if (active.has(key)) return [];
  active.add(key);
  const result = [];
  for (const line of section.lines) {
    if (line.assignment?.command === "include") {
      const target = norm(line.assignment.value);
      if (!config.byKey.has(target)) continue;
      result.push(...expandSection(config, target, active, diagnostics));
    } else if (line.raw.trim() && !/^rem(?:\s|$)/i.test(line.raw.trim())) {
      result.push({ ...line, section: section.name });
    }
  }
  active.delete(key);
  return result;
}

export function configExecution(config, selectedKey) {
  const selected = norm(selectedKey);
  const diagnostics = [];
  const lines = [];
  for (const section of config.sections) {
    if (section.key === "common") {
      lines.push(
        ...expandSectionRecord(config, section, new Set(), diagnostics),
      );
    } else if (section.key === selected) {
      lines.push(
        ...expandSectionRecord(config, section, new Set(), diagnostics),
      );
    }
  }
  return { lines, diagnostics };
}
