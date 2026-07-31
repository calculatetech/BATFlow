import {
  detectLineEnding,
  joinSource,
  makeOpaqueId,
  norm,
  normalizeDosPath,
  normalizeProjectPath,
  reconcileLineIds,
  splitSource,
} from "./batch-core.js?v=0.5.4-dev.29";

export const PRODUCT_NAME = "BATFlow";
export const PRODUCT_VERSION = "0.5.4";
export const PROJECT_FORMAT_VERSION = 2;
export const INTERPRETER_PROFILE = "msdos-7.1-command.com";
export const SUPPORTED_SOURCE_EXTENSIONS = [".bat", ".sys", ".txt"];

const DOS_83_PART = "[A-Za-z0-9$%'_@~`!(){}^#&-]";
const DOS_83_COMPONENT = new RegExp(
  `^${DOS_83_PART}{1,8}(?:\\.${DOS_83_PART}{1,3})?$`,
);
const DOS_DEVICE = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CLASSIC_RELATIVE_PATH_BUDGET = 76;

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

function pathParts(path) {
  return String(path ?? "").split(/[\\/]/);
}

function sourceExtension(path) {
  const filename = pathParts(path).at(-1) || "";
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index).toLowerCase() : "";
}

export function projectPathKey(path) {
  return normalizeProjectPath(path);
}

export function analyzeProjectPath(path) {
  const text = typeof path === "string" ? path : "";
  const parts = pathParts(text);
  const safetyErrors = [];
  if (!text.trim()) safetyErrors.push("Path must not be empty.");
  if (/^[a-z]:/i.test(text) || /^[\\/]/.test(text)) {
    safetyErrors.push("Project paths must be relative.");
  }
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    )
  ) {
    safetyErrors.push(
      "Project paths cannot contain empty, dot, traversal, or control-character components.",
    );
  }

  const noncompliantComponents = parts.filter(
    (part) => !DOS_83_COMPONENT.test(part) || DOS_DEVICE.test(part),
  );
  const supportedType = SUPPORTED_SOURCE_EXTENSIONS.includes(
    sourceExtension(text),
  );
  const warnings = [];
  if (noncompliantComponents.length) {
    warnings.push(
      `Not DOS 8.3 compliant: ${noncompliantComponents.join(", ")}`,
    );
  }
  if (text.length > CLASSIC_RELATIVE_PATH_BUDGET) {
    warnings.push(
      `Relative path exceeds the classic ${CLASSIC_RELATIVE_PATH_BUDGET}-character short-path budget.`,
    );
  }

  return {
    safe: safetyErrors.length === 0,
    safetyErrors,
    dos83Compliant: noncompliantComponents.length === 0,
    noncompliantComponents,
    supportedType,
    warnings,
  };
}

function validatePath(path, { requireDos83 = false } = {}) {
  const analysis = analyzeProjectPath(path);
  if (!analysis.safe) {
    throw new ProjectFormatError(
      `Invalid project file path: ${path}. ${analysis.safetyErrors.join(" ")}`,
    );
  }
  if (!analysis.supportedType) {
    throw new ProjectFormatError(
      `Unsupported project file type: ${path}. Use BAT, SYS, or TXT.`,
    );
  }
  if (requireDos83 && !analysis.dos83Compliant) {
    throw new ProjectFormatError(
      `Project file path must use DOS 8.3 components: ${path}.`,
    );
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
  if (typeof record.id !== "string" || !record.id) {
    throw new ProjectFormatError(`File ${path} must have a durable ID.`);
  }
  const detected = detectLineEnding(record.content);
  const lineEnding = ["CRLF", "LF", "CR"].includes(record.lineEnding)
    ? record.lineEnding
    : preferredLineEnding(detected);
  return {
    id: record.id,
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

function normalizeSimulationScenario(value, options = {}) {
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
  const variableEntries = [];
  const pathEntries = [];
  const outcomeEntries = [];

  for (const [name, value] of Object.entries(variableValues)) {
    const key = norm(name);
    if (!key || typeof value !== "string") {
      throw new ProjectFormatError(
        "Simulation variable names must be non-empty and values must be text.",
      );
    }
    if (value || key === "config") variableEntries.push([key, value]);
  }

  for (const [path, value] of Object.entries(pathValues)) {
    const key = normalizeDosPath(path).trim();
    if (!key || !["yes", "no"].includes(value)) {
      throw new ProjectFormatError(
        'Simulation path values must be either "yes" or "no".',
      );
    }
    pathEntries.push([key, value]);
  }

  for (const [key, value] of Object.entries(outcomeValues)) {
    const normalizedKey = key.trim();
    if (
      options.repairOutOfRangeOutcomes &&
      normalizedKey &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 255
    ) {
      options.discardedSimulationOutcomes += 1;
      continue;
    }
    if (
      !normalizedKey ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 255
    ) {
      throw new ProjectFormatError(
        "Simulation outcomes must be integers from 0 through 255.",
      );
    }
    outcomeEntries.push([normalizedKey, value]);
  }

  return {
    variables: Object.fromEntries(variableEntries),
    paths: Object.fromEntries(pathEntries),
    outcomes: Object.fromEntries(outcomeEntries),
  };
}

function ensureMetadata(project, options) {
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
    options,
  );

  const fileIds = new Set();
  const normalizedLineIds = [];
  const normalizedNotes = [];
  for (const [path, file] of Object.entries(project.files)) {
    if (fileIds.has(file.id)) {
      throw new ProjectFormatError(`Duplicate project file ID: ${file.id}`);
    }
    fileIds.add(file.id);
    const lines = splitSource(file.content).lines;
    const current = Array.isArray(project.metadata.lineIds[file.id])
      ? project.metadata.lineIds[file.id]
      : [];
    const ids = lines.map((_, index) =>
      typeof current[index] === "string" && current[index]
        ? current[index]
        : makeOpaqueId("line"),
    );
    const seen = new Set();
    const durableIds = ids.map((id) => {
      if (seen.has(id)) {
        const replacement = makeOpaqueId("line");
        seen.add(replacement);
        return replacement;
      }
      seen.add(id);
      return id;
    });
    normalizedLineIds.push([file.id, durableIds]);
    normalizedNotes.push([
      file.id,
      safeObject(
        Object.hasOwn(project.metadata.notes, file.id)
          ? project.metadata.notes[file.id]
          : {},
        `Notes for ${path}`,
      ),
    ]);
  }
  project.metadata.lineIds = Object.fromEntries(normalizedLineIds);
  project.metadata.notes = Object.fromEntries(normalizedNotes);
  project.metadata.entryFileId =
    typeof project.metadata.entryFileId === "string" &&
    fileIds.has(project.metadata.entryFileId)
      ? project.metadata.entryFileId
      : preferredEntryFileId(project);
  project.metadata.entryFileExplicit =
    project.metadata.entryFileExplicit === true &&
    Boolean(project.metadata.entryFileId);
}

export function findProjectPath(project, candidate) {
  const key = projectPathKey(candidate);
  return (
    Object.keys(project.files || {}).find(
      (path) => projectPathKey(path) === key,
    ) || null
  );
}

export function filePathForId(project, fileId) {
  return (
    Object.entries(project.files || {}).find(
      ([, file]) => file.id === fileId,
    )?.[0] || null
  );
}

export function preferredEntryFileId(project) {
  const paths = Object.keys(project.files || {}).sort((left, right) =>
    projectPathKey(left).localeCompare(projectPathKey(right)),
  );
  const preferredPath =
    paths.find((path) => projectPathKey(path) === "autoexec.bat") ||
    paths.find((path) => sourceExtension(path) === ".bat") ||
    paths[0];
  return preferredPath ? project.files[preferredPath].id : null;
}

function removeFileOutcomes(outcomes, fileId) {
  return Object.fromEntries(
    Object.entries(outcomes || {}).filter(([key]) => {
      try {
        const identity = JSON.parse(key);
        return !Array.isArray(identity) || identity[0] !== fileId;
      } catch {
        return true;
      }
    }),
  );
}

export function validateProject(value, options = {}) {
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
  const pathKeys = new Set();
  for (const [path, record] of Object.entries(input.files)) {
    validatePath(path);
    const key = projectPathKey(path);
    if (pathKeys.has(key)) {
      throw new ProjectFormatError(
        `Project contains a DOS-insensitive path collision: ${path}`,
      );
    }
    pathKeys.add(key);
    normalizedFiles[path] = normalizeFileRecord(record, path);
  }
  input.files = normalizedFiles;
  ensureMetadata(input, options);
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
      entryFileId: null,
      entryFileExplicit: false,
      simulationScenario: createSimulationScenario(),
    },
  });
}

export function updateProjectName(projectValue, name) {
  const project = validateProject(projectValue);
  const nextName = String(name ?? "").trim();
  if (!nextName) {
    throw new ProjectFormatError("Project name must be non-empty text.");
  }
  project.name = nextName;
  return validateProject(project);
}

export function setProjectEntryFile(projectValue, fileId) {
  const project = validateProject(projectValue);
  if (!filePathForId(project, fileId)) {
    throw new ProjectFormatError(`Project entry file not found: ${fileId}`);
  }
  project.metadata.entryFileId = fileId;
  project.metadata.entryFileExplicit = true;
  return validateProject(project);
}

export function renameProjectFile(projectValue, currentPath, nextPath) {
  validatePath(nextPath, { requireDos83: true });
  const project = validateProject(projectValue);
  const actualPath = findProjectPath(project, currentPath);
  if (!actualPath) {
    throw new ProjectFormatError(`Project file not found: ${currentPath}`);
  }
  const collision = findProjectPath(project, nextPath);
  if (collision && collision !== actualPath) {
    throw new ProjectFormatError(
      `Project file already exists under DOS path rules: ${nextPath}`,
    );
  }
  if (actualPath === nextPath) return project;
  const entries = Object.entries(project.files).map(([path, file]) =>
    path === actualPath ? [nextPath, file] : [path, file],
  );
  project.files = Object.fromEntries(entries);
  return validateProject(project);
}

export function deleteProjectFile(projectValue, path) {
  const project = validateProject(projectValue);
  const actualPath = findProjectPath(project, path);
  if (!actualPath) {
    throw new ProjectFormatError(`Project file not found: ${path}`);
  }
  const fileId = project.files[actualPath].id;
  delete project.files[actualPath];
  delete project.metadata.notes[fileId];
  delete project.metadata.lineIds[fileId];
  project.metadata.simulationScenario.outcomes = removeFileOutcomes(
    project.metadata.simulationScenario.outcomes,
    fileId,
  );
  if (project.metadata.entryFileId === fileId) {
    project.metadata.entryFileId = preferredEntryFileId(project);
    project.metadata.entryFileExplicit = false;
  }
  return validateProject(project);
}

function dos83Basis(value, fallback) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9$%'_@~`!(){}^#&-]/g, "");
  return cleaned || fallback;
}

export function uniqueDosProjectPath(projectValue, desiredPath) {
  const project = validateProject(projectValue);
  return uniqueDosPathForFiles(project.files, desiredPath);
}

function uniqueDosPathForFiles(files, desiredPath) {
  const separatorIndex = Math.max(
    desiredPath.lastIndexOf("/"),
    desiredPath.lastIndexOf("\\"),
  );
  const directory =
    separatorIndex >= 0 ? desiredPath.slice(0, separatorIndex + 1) : "";
  const filename =
    separatorIndex >= 0 ? desiredPath.slice(separatorIndex + 1) : desiredPath;
  const dotIndex = filename.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const rawExtension = dotIndex > 0 ? filename.slice(dotIndex + 1) : "";
  const base = dos83Basis(rawBase, "FILE");
  const extension = dos83Basis(rawExtension, "").slice(0, 3);

  for (let number = 1; number <= 999999; number += 1) {
    const tail = `~${number}`;
    const candidateBase = `${base.slice(0, Math.max(1, 8 - tail.length))}${tail}`;
    const candidate = `${directory}${candidateBase}${
      extension ? `.${extension}` : ""
    }`;
    const collision = Object.keys(files).some(
      (path) => projectPathKey(path) === projectPathKey(candidate),
    );
    if (!collision) return candidate;
  }
  throw new ProjectFormatError(
    `Could not generate a unique DOS 8.3 path for ${desiredPath}.`,
  );
}

export function updateProjectSimulationScenario(projectValue, scenario) {
  const project = validateProject(projectValue);
  project.metadata.simulationScenario = normalizeSimulationScenario(scenario);
  return validateProject(project);
}

function migrateOutcomeKeys(outcomes, pathToId, normalizedPathToId) {
  const migrated = [];
  for (const [key, value] of Object.entries(outcomes || {})) {
    let nextKey = key;
    try {
      const identity = JSON.parse(key);
      const fileId =
        pathToId.get(identity?.[0]) ||
        normalizedPathToId.get(projectPathKey(identity?.[0]));
      if (Array.isArray(identity) && fileId) {
        identity[0] = fileId;
        nextKey = JSON.stringify(identity);
      }
    } catch {
      // Outcome identities are opaque. Unknown historical keys are retained.
    }
    migrated.push([nextKey, value]);
  }
  return Object.fromEntries(migrated);
}

function migrateVersion1Project(value) {
  const project = safeObject(clone(value), "Project");
  project.files = safeObject(project.files || {}, "Project files");
  const oldMetadata = safeObject(project.metadata || {}, "Project metadata");
  const oldNotes = safeObject(oldMetadata.notes || {}, "Project notes");
  const oldLineIds = safeObject(oldMetadata.lineIds || {}, "Project line IDs");
  const pathToId = new Map();
  const normalizedPathToId = new Map();
  const migratedFiles = {};
  const notes = {};
  const lineIds = {};

  for (const [path, fileValue] of Object.entries(project.files)) {
    const file = safeObject(fileValue, `File ${path}`);
    const id = makeOpaqueId("file");
    file.id = id;
    const normalizedPath = projectPathKey(path);
    const destination = Object.keys(migratedFiles).some(
      (candidate) => projectPathKey(candidate) === normalizedPath,
    )
      ? uniqueDosPathForFiles(migratedFiles, path)
      : path;
    migratedFiles[destination] = file;
    pathToId.set(path, id);
    if (!normalizedPathToId.has(normalizedPath)) {
      normalizedPathToId.set(normalizedPath, id);
    }
    notes[id] = safeObject(oldNotes[path] || {}, `Notes for ${path}`);
    lineIds[id] = Array.isArray(oldLineIds[path]) ? oldLineIds[path] : [];
  }
  project.files = migratedFiles;

  const scenario = safeObject(
    oldMetadata.simulationScenario || createSimulationScenario(),
    "Simulation scenario",
  );
  project.metadata = {
    ...oldMetadata,
    notes,
    lineIds,
    entryFileId: null,
    entryFileExplicit: false,
    simulationScenario: {
      ...scenario,
      outcomes: migrateOutcomeKeys(
        scenario.outcomes,
        pathToId,
        normalizedPathToId,
      ),
    },
  };
  return project;
}

export function importProjectDocument(value) {
  const document = safeObject(value, "Project document");
  const repairOptions = {
    repairOutOfRangeOutcomes: true,
    discardedSimulationOutcomes: 0,
  };
  if (document.formatVersion !== undefined) {
    if (![1, PROJECT_FORMAT_VERSION].includes(document.formatVersion)) {
      throw new ProjectFormatError(
        `Unsupported project format version: ${document.formatVersion}`,
      );
    }
    const migrated = document.formatVersion === 1;
    return {
      project: validateProject(
        migrated ? migrateVersion1Project(document.project) : document.project,
        repairOptions,
      ),
      migrated,
      sourceFormat: `batflow-${document.formatVersion}`,
      discardedSimulationOutcomes: repairOptions.discardedSimulationOutcomes,
    };
  }

  const legacyProject =
    document.project && !document.files ? document.project : document;
  if (!legacyProject.files || typeof legacyProject.name !== "string") {
    throw new ProjectFormatError("Unrecognized legacy project document.");
  }
  return {
    project: validateProject(
      migrateVersion1Project(legacyProject),
      repairOptions,
    ),
    migrated: true,
    sourceFormat: "legacy-unversioned",
    discardedSimulationOutcomes: repairOptions.discardedSimulationOutcomes,
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
  const existingPath = findProjectPath(project, path);
  if (existingPath && !options.replace) {
    throw new ProjectFormatError(`Project file already exists: ${path}`);
  }
  const detected = detectLineEnding(text);
  const lineEnding = preferredLineEnding(detected);
  const existing = existingPath ? project.files[existingPath] : null;
  const destinationPath = existingPath || path;
  project.files[destinationPath] = {
    id: existing?.id || makeOpaqueId("file"),
    content: String(text),
    encoding: "utf-8",
    lineEnding,
    normalizedFromMixedLineEndings: detected === "MIXED",
  };
  const fileId = project.files[destinationPath].id;
  project.metadata.notes[fileId] = {};
  project.metadata.lineIds[fileId] = splitSource(text).lines.map(() =>
    (options.makeId || (() => makeOpaqueId("line")))(),
  );
  project.metadata.simulationScenario.outcomes = removeFileOutcomes(
    project.metadata.simulationScenario.outcomes,
    fileId,
  );
  if (!project.metadata.entryFileExplicit) {
    project.metadata.entryFileId = preferredEntryFileId(project);
  }
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
  const oldIds = project.metadata.lineIds[file.id] || [];
  const makeId = options.makeId || (() => makeOpaqueId("line"));
  const lineIds = options.lineIds
    ? newSplit.lines.map((_, index) => options.lineIds[index] || makeId())
    : reconcileLineIds(oldSplit.lines, oldIds, newSplit.lines, makeId);
  file.content = joinSource(newSplit.lines, file.lineEnding);
  file.normalizedFromMixedLineEndings = false;
  project.metadata.lineIds[file.id] = lineIds;

  const validIds = new Set(lineIds);
  const notes = project.metadata.notes[file.id] || {};
  project.metadata.notes[file.id] = Object.fromEntries(
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
  const ids = [...project.metadata.lineIds[file.id]];
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
  const ids = [...project.metadata.lineIds[file.id]];
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
      "The selected file is not valid UTF-8. BATFlow 0.5.4 does not guess DOS code pages.",
    );
  }
}
