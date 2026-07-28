import {
  detectLineEnding,
  joinSource,
  makeOpaqueId,
  norm,
  normalizeDosPath,
  reconcileLineIds,
  splitSource,
} from "./batch-core.js?v=0.5.1-dev";

export const PRODUCT_NAME = "BATFlow";
export const PRODUCT_VERSION = "0.5.1";
export const PROJECT_FORMAT_VERSION = 1;
export const INTERPRETER_PROFILE = "msdos-7.1-command.com";

export class ProjectFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectFormatError(`${label} must be an object.`);
  }
  return value;
}

function validatePath(path) {
  if (
    typeof path !== "string" ||
    !path.trim() ||
    /^[a-z]:[\\/]/i.test(path) ||
    /^[\\/]/.test(path) ||
    path.replace(/\\/g, "/").split("/").includes("..")
  ) {
    throw new ProjectFormatError(`Invalid project file path: ${path}`);
  }
}

function preferredLineEnding(detected) {
  return ["CRLF", "LF", "CR"].includes(detected) ? detected : "CRLF";
}

function normalizeFileRecord(record, path) {
  safeObject(record, `File ${path}`);
  if (typeof record.content !== "string") {
    throw new ProjectFormatError(`File ${path} content must be text.`);
  }
  const detected = detectLineEnding(record.content);
  const lineEnding = ["CRLF", "LF", "CR"].includes(record.lineEnding)
    ? record.lineEnding
    : preferredLineEnding(detected);
  return {
    content: record.content,
    encoding: "utf-8",
    lineEnding,
    normalizedFromMixedLineEndings: detected === "MIXED",
  };
}

export function createSimulationScenario() {
  return {
    variables: {},
    paths: {},
    outcomes: {},
  };
}

function normalizeSimulationScenario(value) {
  const scenario = safeObject(value, "Simulation scenario");
  const variableValues = safeObject(
    scenario.variables === undefined ? {} : scenario.variables,
    "Simulation variables",
  );
  const pathValues = safeObject(
    scenario.paths === undefined ? {} : scenario.paths,
    "Simulation paths",
  );
  const outcomeValues = safeObject(
    scenario.outcomes === undefined ? {} : scenario.outcomes,
    "Simulation outcomes",
  );
  const variables = {};
  const paths = {};
  const outcomes = {};

  for (const [name, value] of Object.entries(variableValues)) {
    const key = norm(name);
    if (!key || typeof value !== "string") {
      throw new ProjectFormatError(
        "Simulation variable names must be non-empty and values must be text.",
      );
    }
    if (value) variables[key] = value;
  }

  for (const [path, value] of Object.entries(pathValues)) {
    const key = normalizeDosPath(path).trim();
    if (!key || !["yes", "no"].includes(value)) {
      throw new ProjectFormatError(
        'Simulation path values must be either "yes" or "no".',
      );
    }
    paths[key] = value;
  }

  for (const [key, value] of Object.entries(outcomeValues)) {
    const normalizedKey = key.trim();
    if (
      !normalizedKey ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new ProjectFormatError(
        "Simulation outcomes must be non-negative integers.",
      );
    }
    outcomes[normalizedKey] = value;
  }

  return { variables, paths, outcomes };
}

function ensureMetadata(project) {
  project.metadata = safeObject(project.metadata || {}, "Project metadata");
  project.metadata.notes = safeObject(
    project.metadata.notes || {},
    "Project notes",
  );
  project.metadata.lineIds = safeObject(
    project.metadata.lineIds || {},
    "Project line IDs",
  );
  project.metadata.simulationScenario = normalizeSimulationScenario(
    project.metadata.simulationScenario === undefined
      ? createSimulationScenario()
      : project.metadata.simulationScenario,
  );

  for (const [path, file] of Object.entries(project.files)) {
    const lines = splitSource(file.content).lines;
    const current = Array.isArray(project.metadata.lineIds[path])
      ? project.metadata.lineIds[path]
      : [];
    const ids = lines.map((_, index) =>
      typeof current[index] === "string" && current[index]
        ? current[index]
        : makeOpaqueId("line"),
    );
    const seen = new Set();
    project.metadata.lineIds[path] = ids.map((id) => {
      if (seen.has(id)) {
        const replacement = makeOpaqueId("line");
        seen.add(replacement);
        return replacement;
      }
      seen.add(id);
      return id;
    });
    project.metadata.notes[path] = safeObject(
      project.metadata.notes[path] || {},
      `Notes for ${path}`,
    );
  }
}

export function validateProject(value) {
  const input = safeObject(clone(value), "Project");
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new ProjectFormatError("Project name must be non-empty text.");
  }
  input.id =
    typeof input.id === "string" && input.id
      ? input.id
      : makeOpaqueId("project");
  input.files = safeObject(input.files || {}, "Project files");
  const normalizedFiles = {};
  for (const [path, record] of Object.entries(input.files)) {
    validatePath(path);
    normalizedFiles[path] = normalizeFileRecord(record, path);
  }
  input.files = normalizedFiles;
  ensureMetadata(input);
  return input;
}

export function createProject(name = "Untitled") {
  return validateProject({
    id: makeOpaqueId("project"),
    name,
    files: {},
    metadata: {
      notes: {},
      lineIds: {},
      simulationScenario: createSimulationScenario(),
    },
  });
}

export function updateProjectSimulationScenario(projectValue, scenario) {
  const project = validateProject(projectValue);
  project.metadata.simulationScenario = normalizeSimulationScenario(scenario);
  return validateProject(project);
}

export function importProjectDocument(value) {
  const document = safeObject(value, "Project document");
  if (document.formatVersion !== undefined) {
    if (document.formatVersion !== PROJECT_FORMAT_VERSION) {
      throw new ProjectFormatError(
        `Unsupported project format version: ${document.formatVersion}`,
      );
    }
    return {
      project: validateProject(document.project),
      migrated: false,
      sourceFormat: `batflow-${document.formatVersion}`,
    };
  }

  const legacyProject =
    document.project && !document.files ? document.project : document;
  if (!legacyProject.files || typeof legacyProject.name !== "string") {
    throw new ProjectFormatError("Unrecognized legacy project document.");
  }
  return {
    project: validateProject(legacyProject),
    migrated: true,
    sourceFormat: "legacy-unversioned",
  };
}

export function exportProjectDocument(project) {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    createdBy: {
      product: PRODUCT_NAME,
      productVersion: PRODUCT_VERSION,
    },
    interpreterProfile: INTERPRETER_PROFILE,
    project: validateProject(project),
  };
}

export function serializeProject(project) {
  return `${JSON.stringify(exportProjectDocument(project), null, 2)}\n`;
}

export function addTextFile(projectValue, path, text, options = {}) {
  validatePath(path);
  const project = validateProject(projectValue);
  const detected = detectLineEnding(text);
  const lineEnding = preferredLineEnding(detected);
  project.files[path] = {
    content: String(text),
    encoding: "utf-8",
    lineEnding,
    normalizedFromMixedLineEndings: detected === "MIXED",
  };
  project.metadata.notes[path] ||= {};
  project.metadata.lineIds[path] = splitSource(text).lines.map(() =>
    (options.makeId || (() => makeOpaqueId("line")))(),
  );
  return validateProject(project);
}

export function updateFileContent(
  projectValue,
  path,
  editorText,
  options = {},
) {
  const project = validateProject(projectValue);
  const file = project.files[path];
  if (!file) throw new ProjectFormatError(`Project file not found: ${path}`);
  const oldSplit = splitSource(file.content);
  const newSplit = splitSource(editorText);
  const oldIds = project.metadata.lineIds[path] || [];
  const makeId = options.makeId || (() => makeOpaqueId("line"));
  const lineIds = options.lineIds
    ? newSplit.lines.map((_, index) => options.lineIds[index] || makeId())
    : reconcileLineIds(oldSplit.lines, oldIds, newSplit.lines, makeId);
  file.content = joinSource(newSplit.lines, file.lineEnding);
  file.normalizedFromMixedLineEndings = false;
  project.metadata.lineIds[path] = lineIds;

  const validIds = new Set(lineIds);
  const notes = project.metadata.notes[path] || {};
  project.metadata.notes[path] = Object.fromEntries(
    Object.entries(notes).filter(([id]) => validIds.has(id)),
  );
  return project;
}

export function duplicateProjectLine(projectValue, path, lineIndex) {
  const project = validateProject(projectValue);
  const file = project.files[path];
  if (!file) throw new ProjectFormatError(`Project file not found: ${path}`);
  const lines = splitSource(file.content).lines;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new ProjectFormatError(`Invalid line index: ${lineIndex}`);
  }
  lines.splice(lineIndex + 1, 0, lines[lineIndex]);
  const ids = [...project.metadata.lineIds[path]];
  ids.splice(lineIndex + 1, 0, makeOpaqueId("line"));
  return updateFileContent(project, path, joinSource(lines, file.lineEnding), {
    lineIds: ids,
  });
}

export function deleteProjectLine(projectValue, path, lineIndex) {
  const project = validateProject(projectValue);
  const file = project.files[path];
  if (!file) throw new ProjectFormatError(`Project file not found: ${path}`);
  const lines = splitSource(file.content).lines;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new ProjectFormatError(`Invalid line index: ${lineIndex}`);
  }
  lines.splice(lineIndex, 1);
  const ids = [...project.metadata.lineIds[path]];
  ids.splice(lineIndex, 1);
  return updateFileContent(project, path, joinSource(lines, file.lineEnding), {
    lineIds: ids,
  });
}

export function decodeUtf8(bytes) {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded.replace(/^\uFEFF/, "");
  } catch {
    throw new ProjectFormatError(
      "The selected file is not valid UTF-8. BATFlow 0.5.1 does not guess DOS code pages.",
    );
  }
}
