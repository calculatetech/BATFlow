import {
  normalizeDosPath,
  norm,
  parseBatch,
  resolveBatchTarget,
} from "./lib/batch-core.js?v=0.5.3-dev";
import {
  INTERPRETER_PROFILE,
  PROJECT_FORMAT_VERSION,
  PRODUCT_VERSION,
  ProjectFormatError,
  addTextFile,
  analyzeProjectPath,
  createProject,
  decodeUtf8,
  deleteProjectFile,
  deleteProjectLine,
  duplicateProjectLine,
  filePathForId,
  findProjectPath,
  importProjectDocument,
  renameProjectFile,
  serializeProject,
  setProjectEntryFile,
  uniqueDosProjectPath,
  updateFileContent,
  updateProjectName,
  updateProjectSimulationScenario,
} from "./lib/project-format.js?v=0.5.3-dev";
import {
  DATABASE_VERSION,
  loadCurrentProject,
  saveCurrentProject,
} from "./lib/storage.js?v=0.5.3-dev";
import { createSaveQueue } from "./lib/save-queue.js?v=0.5.3-dev";
import {
  DIAGNOSTICS_FORMAT_VERSION,
  createDiagnosticsDocument,
  createDiagnosticsStore,
} from "./lib/diagnostics.js?v=0.5.3-dev";
import {
  collectOutcomeRequests,
  simulate,
} from "./lib/simulation.js?v=0.5.3-dev";

const $ = (id) => document.getElementById(id);
const state = {
  project: createProject(),
  currentFile: null,
  parsed: null,
  selectedId: null,
  view: "diagram",
  trace: [],
  traceStop: "",
  traceEnabled: true,
  message: "",
  messageKind: "",
  pendingImport: null,
};
const diagnostics = createDiagnosticsStore();
const earlyDiagnostics = globalThis.__batflowEarlyDiagnostics;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function setMessage(message, kind = "") {
  state.message = message;
  state.messageKind = kind;
  const element = $("appMessage");
  element.textContent = message;
  element.className = `app-message ${kind}`.trim();
}

function errorDetail(error) {
  if (!error) return "";
  return [error.name, error.message, error.stack].filter(Boolean).join("\n");
}

function refreshDiagnostics() {
  renderDiagnostics();
}

function recordDiagnostic(event) {
  diagnostics.record(event);
  refreshDiagnostics();
}

function setDiagnosticSubsystem(name, status, details = {}) {
  diagnostics.setSubsystem(name, status, details);
  refreshDiagnostics();
}

function handleSaveState(event) {
  const previous = diagnostics.getSnapshot();
  if (event.status === "unsaved" || event.status === "saving") {
    setDiagnosticSubsystem("save", event.status);
    return;
  }
  if (event.status === "failed") {
    setDiagnosticSubsystem("save", "error", {
      detail: errorDetail(event.error),
    });
    setDiagnosticSubsystem("storage", "error", {
      detail: errorDetail(event.error),
    });
    recordDiagnostic({
      severity: "error",
      subsystem: "save",
      code: "storage.save.failed",
      summary: "Project changes could not be saved.",
      detail: errorDetail(event.error),
    });
    return;
  }
  if (event.status === "saved") {
    setDiagnosticSubsystem("save", "saved", { successfulAt: true });
    setDiagnosticSubsystem("storage", "healthy");
    if (
      previous.subsystems.save.status === "error" ||
      previous.subsystems.storage.status === "error"
    ) {
      recordDiagnostic({
        severity: "info",
        subsystem: "save",
        code: "storage.save.recovered",
        summary: "Project saving recovered.",
      });
    }
  }
}

const projectSaveQueue = createSaveQueue({
  save: saveCurrentProject,
  onStatus: setMessage,
  onState: handleSaveState,
});

function projectHasWork() {
  return (
    Object.keys(state.project.files).length > 0 ||
    state.project.name !== "Untitled" ||
    scenarioHasValues()
  );
}

function entryFilePath(project = state.project) {
  return filePathForId(project, project.metadata.entryFileId);
}

function storedSimulationScenario() {
  return state.project.metadata.simulationScenario;
}

function currentSimulationScenario() {
  const scenario = storedSimulationScenario();
  const configDefault = state.parsed?.configInfo?.menuDefault;
  if (!configDefault || Object.hasOwn(scenario.variables, "config")) {
    return scenario;
  }
  return {
    ...scenario,
    variables: {
      ...scenario.variables,
      config: configDefault,
    },
  };
}

function scenarioHasValues(scenario = storedSimulationScenario()) {
  return ["variables", "paths", "outcomes"].some(
    (key) => Object.keys(scenario[key]).length > 0,
  );
}

function parseCurrent() {
  if (!state.currentFile || !state.project.files[state.currentFile]) {
    state.currentFile = null;
    state.parsed = null;
    state.selectedId = null;
    state.trace = [];
    state.traceStop = "";
    return;
  }
  const file = state.project.files[state.currentFile];
  state.parsed = parseBatch(file.content, state.currentFile, {
    fileId: file.id,
    lineIds: state.project.metadata.lineIds[file.id],
    projectFiles: state.project.files,
  });
  if (
    state.selectedId &&
    !state.parsed.blocks.some((block) => block.id === state.selectedId)
  ) {
    state.selectedId = null;
  }
}

function queueSave({ immediate = false } = {}) {
  return projectSaveQueue.queue(state.project, { immediate });
}

function recalculateTrace() {
  if (!state.parsed || !state.traceEnabled) {
    state.trace = [];
    state.traceStop = state.traceEnabled ? "" : "Trace disabled";
    return;
  }
  const result = simulate(state.parsed, currentSimulationScenario(), {
    projectFiles: state.project.files,
  });
  state.trace = result.trace;
  state.traceStop = result.stop;
}

function render() {
  parseCurrent();
  recalculateTrace();
  renderFiles();
  renderEditor();
  renderSimulationInputs();
  renderLabels();
  renderValidation();
  renderInspector();
  renderTraceView();
  applyView();
  updateStatus();
  renderDiagnostics();
}

function renderFiles() {
  const files = Object.keys(state.project.files);
  const nameInput = $("projectName");
  if (document.activeElement !== nameInput)
    nameInput.value = state.project.name;
  $("fileList").innerHTML = files.length
    ? files
        .map(
          (path) =>
            `<button class="file-item ${path === state.currentFile ? "active" : ""}" ` +
            `data-file="${escapeAttr(path)}" type="button">` +
            `<span>${escapeHtml(path)}</span>` +
            `${
              state.project.files[path].id ===
              state.project.metadata.entryFileId
                ? '<span class="file-badge">ENTRY</span>'
                : ""
            }${
              analyzeProjectPath(path).warnings.length
                ? '<span class="file-warning" aria-label="Path warning">!</span>'
                : ""
            }</button>`,
        )
        .join("")
    : '<p class="empty-state">Import a UTF-8 BAT, SYS, or TXT file.</p>';
  document.querySelectorAll("[data-file]").forEach((button) => {
    button.onclick = () => {
      state.currentFile = button.dataset.file;
      state.selectedId = null;
      render();
    };
  });
  const selected = state.currentFile
    ? state.project.files[state.currentFile]
    : null;
  $("renameFile").disabled = !selected;
  $("deleteFile").disabled = !selected;
  $("setEntryFile").disabled =
    !selected || selected.id === state.project.metadata.entryFileId;
}

function renderEditor() {
  if (!state.parsed) {
    $("diagramView").innerHTML =
      '<div class="empty-state large">No file selected.</div>';
    $("sourceView").value = "";
    $("sourceView").disabled = true;
    return;
  }
  $("sourceView").disabled = false;
  $("sourceView").value = state.project.files[state.currentFile].content;
  renderDiagram();
}

function renderDiagram() {
  if (!state.parsed) return;
  const tracedIds = new Set(state.trace.map((row) => row.blockId));
  $("diagramView").innerHTML = state.parsed.sections
    .map((section) => {
      const labels = section.labels.length
        ? section.labels
            .map(
              (label, index) =>
                `<button class="label-badge" type="button" ` +
                `data-block="${escapeAttr(section.labelBlocks[index])}">` +
                `:${escapeHtml(label)}</button>`,
            )
            .join("")
        : '<span class="label-badge">ENTRY</span>';
      const blocks = section.blocks
        .filter((block) => block.kind !== "blank")
        .map((block) => blockHtml(block, tracedIds.has(block.id)))
        .join("");
      return (
        `<section class="section-group"><div class="section-title">${labels}</div>` +
        `<div class="flow-column">${blocks || '<div class="empty-state">Labels only</div>'}</div>` +
        "</section>"
      );
    })
    .join("");

  document.querySelectorAll(".block[data-id]").forEach((element) => {
    element.onclick = (event) => {
      if (event.target.closest("[data-open-file]")) return;
      selectBlock(element.dataset.id);
    };
    element.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectBlock(element.dataset.id);
      }
    };
  });
  document.querySelectorAll("[data-block]").forEach((element) => {
    if (element.classList.contains("label-badge")) {
      element.onclick = () => selectBlock(element.dataset.block);
    }
  });
  document.querySelectorAll("[data-open-file]").forEach((button) => {
    button.onclick = () => openProjectFile(button.dataset.openFile);
  });
}

function blockHtml(block, traced) {
  let meta = `Line ${block.line + 1}`;
  let branches = "";
  if (block.kind === "if") {
    meta += ` · ${block.data.type}${block.data.negated ? " · NOT" : ""}`;
    branches =
      `<div class="branch-row"><span class="branch-yes">TRUE → ${escapeHtml(block.data.action || "continue")}</span>` +
      '<span class="branch-no">FALSE → continue</span></div>';
  }
  if (block.kind === "goto")
    meta += ` · target :${escapeHtml(block.data.target)}`;
  if (block.kind === "call" || block.kind === "batch-transfer") {
    const targetPath = resolveBatchTarget(
      block.data.target,
      state.currentFile,
      state.project.files,
    );
    meta += targetPath ? ` · ${escapeHtml(targetPath)}` : " · unresolved file";
    branches =
      `<div class="branch-row single"><button class="branch-jump" type="button" ` +
      `${targetPath ? `data-open-file="${escapeAttr(targetPath)}"` : "disabled"}>` +
      `${block.kind === "call" ? "OPEN CALLED FILE" : "OPEN TRANSFER TARGET"} → ` +
      `${escapeHtml(block.data.target)}</button></div>`;
  }
  if (
    block.kind === "command" &&
    ["ren", "rename"].includes(block.data.command)
  ) {
    meta +=
      ` · ${escapeHtml(block.data.source || "(missing)")} → ` +
      escapeHtml(block.data.resolvedDestination || "(invalid destination)");
  }
  return (
    `<article tabindex="0" role="button" class="block kind-${block.kind} ` +
    `${state.selectedId === block.id ? "selected" : ""} ${traced ? "traced" : ""}" ` +
    `data-id="${escapeAttr(block.id)}"><div class="block-title">` +
    `<span>${escapeHtml(block.title)}</span><span>${escapeHtml(block.kind)}</span></div>` +
    `<div class="block-code">${escapeHtml(block.raw)}</div>` +
    `<div class="block-meta">${meta}</div>${branches}</article>`
  );
}

function openProjectFile(path) {
  if (!state.project.files[path]) return;
  state.currentFile = path;
  state.selectedId = null;
  render();
}

function selectBlock(id) {
  state.selectedId = id;
  renderDiagram();
  renderInspector();
  const block = state.parsed?.blocks.find((item) => item.id === id);
  const element = document.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (block && (state.view === "split" || state.view === "source")) {
    jumpSourceToLine(block.line);
  }
}

function jumpSourceToLine(lineIndex) {
  const source = $("sourceView");
  const lines = source.value.split("\n");
  const start = lines
    .slice(0, lineIndex)
    .reduce((offset, line) => offset + line.length + 1, 0);
  const end = start + (lines[lineIndex]?.length || 0);
  source.focus();
  source.setSelectionRange(start, end);
  const lineHeight =
    Number.parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(
    0,
    lineIndex * lineHeight - source.clientHeight / 2,
  );
}

function renderInspector() {
  const inspector = $("inspector");
  if (!state.parsed || !state.selectedId) {
    inspector.className = "inspector empty";
    inspector.textContent = "Select a block.";
    return;
  }
  const block = state.parsed.blocks.find(
    (item) => item.id === state.selectedId,
  );
  if (!block) return;
  inspector.className = "inspector";
  inspector.innerHTML =
    `<label for="blockType">Block type</label>` +
    `<input id="blockType" value="${escapeAttr(block.kind)}" disabled>` +
    `<label for="editRaw">Source line</label>` +
    `<textarea id="editRaw">${escapeHtml(block.raw)}</textarea>` +
    `<label for="editNote">Manual note</label>` +
    `<textarea id="editNote">${escapeHtml(getNote(block.id))}</textarea>` +
    '<div class="button-row"><button id="applyEdit" type="button">Apply</button>' +
    '<button id="duplicateBlock" type="button">Duplicate</button>' +
    '<button id="deleteBlock" type="button">Delete</button></div>';
  $("applyEdit").onclick = () =>
    editBlock(block, $("editRaw").value, $("editNote").value);
  $("duplicateBlock").onclick = () => {
    state.project = duplicateProjectLine(
      state.project,
      state.currentFile,
      block.line,
    );
    render();
    queueSave();
  };
  $("deleteBlock").onclick = () => {
    state.project = deleteProjectLine(
      state.project,
      state.currentFile,
      block.line,
    );
    state.selectedId = null;
    render();
    queueSave();
  };
}

function getNote(id) {
  const fileId = state.project.files[state.currentFile]?.id;
  return state.project.metadata.notes[fileId]?.[id] || "";
}

function editBlock(block, raw, note) {
  const lines = [...state.parsed.lines];
  lines[block.line] = raw;
  const lineEnding = state.project.files[state.currentFile].lineEnding;
  const separator =
    lineEnding === "LF" ? "\n" : lineEnding === "CR" ? "\r" : "\r\n";
  state.project = updateFileContent(
    state.project,
    state.currentFile,
    lines.join(separator),
  );
  const fileId = state.project.files[state.currentFile].id;
  state.project.metadata.notes[fileId][block.id] = note;
  render();
  queueSave();
}

function renderValidation() {
  if (!state.parsed) {
    $("validation").innerHTML =
      '<div class="empty-state">No file selected.</div>';
    return;
  }
  const pathWarnings = analyzeProjectPath(state.currentFile).warnings.map(
    (message) => ({
      message: `Project path: ${message}`,
      severity: "warning",
      blockId: "",
    }),
  );
  const validations = [...pathWarnings, ...state.parsed.validations];
  $("validation").innerHTML = validations.length
    ? validations
        .map(
          (item) =>
            `<button class="validation-item ${item.severity === "error" ? "error" : ""}" ` +
            `${
              item.blockId
                ? `data-validation-block="${escapeAttr(item.blockId)}"`
                : "disabled"
            } type="button">` +
            `${escapeHtml(item.message)}</button>`,
        )
        .join("")
    : '<div class="trace-summary">No detected issues.</div>';
  document.querySelectorAll("[data-validation-block]").forEach((button) => {
    button.onclick = () => selectBlock(button.dataset.validationBlock);
  });
}

function renderLabels() {
  if (!state.parsed) {
    $("labelList").innerHTML = "";
    return;
  }
  $("labelList").innerHTML = [
    '<button class="label-link" type="button" data-entry>ENTRY</button>',
    ...[...state.parsed.labels.entries()].map(
      ([key, value]) =>
        `<button class="label-link" type="button" data-label="${escapeAttr(key)}" ` +
        `data-label-block="${escapeAttr(value.blockId)}">:${escapeHtml(key)}</button>`,
    ),
  ].join("");
  document.querySelector("[data-entry]").onclick = () => {
    state.selectedId = state.parsed.blocks.find(
      (block) => block.kind !== "blank",
    )?.id;
    if (state.selectedId) selectBlock(state.selectedId);
  };
  document.querySelectorAll("[data-label-block]").forEach((button) => {
    button.onclick = () => selectBlock(button.dataset.labelBlock);
  });
}

function renderSimulationInputs() {
  $("resetSimulation").disabled = !scenarioHasValues();
  if (!state.parsed) {
    $("simulationInputs").innerHTML =
      '<div class="empty-state">No file selected.</div>';
    $("traceSummary").textContent = "";
    return;
  }
  const scenario = currentSimulationScenario();
  const configDefault = state.parsed.configInfo?.menuDefault;
  const variables = state.parsed.variables
    .map((item) => {
      const key = norm(item.name);
      const explicit = Object.hasOwn(storedSimulationScenario().variables, key);
      const derived = key === "config" && !explicit && Boolean(configDefault);
      const saved = Object.hasOwn(scenario.variables, key)
        ? scenario.variables[key]
        : "";
      if (item.values.length) {
        const known = item.values.includes(saved);
        const custom = Boolean(saved && !known);
        return (
          `<div class="sim-input"><label for="var-${escapeAttr(key)}">%${escapeHtml(item.name)}%</label>` +
          `<select id="var-${escapeAttr(key)}" data-var="${escapeAttr(key)}" ` +
          `data-effective="${escapeAttr(saved)}" ` +
          `data-derived="${derived}">` +
          '<option value="">— choose —</option>' +
          item.values
            .map(
              (value) =>
                `<option value="${escapeAttr(value)}" ${saved === value ? "selected" : ""}>` +
                `${escapeHtml(value)}</option>`,
            )
            .join("") +
          `<option value="__custom" ${custom ? "selected" : ""}>Custom…</option></select>` +
          `<input ${custom ? "" : 'class="hidden"'} data-custom="${escapeAttr(key)}" ` +
          `value="${custom ? escapeAttr(saved) : ""}" placeholder="custom value"></div>`
        );
      }
      return (
        `<div class="sim-input"><label for="var-${escapeAttr(key)}">%${escapeHtml(item.name)}%</label>` +
        `<input id="var-${escapeAttr(key)}" data-var="${escapeAttr(key)}" ` +
        `value="${escapeAttr(saved)}" placeholder="value"></div>`
      );
    })
    .join("");
  const paths = state.parsed.paths
    .map((item, index) => {
      const key = normalizeDosPath(item);
      const saved = Object.hasOwn(scenario.paths, key)
        ? scenario.paths[key]
        : "unknown";
      return (
        `<div class="sim-input"><label for="path-${index}">${escapeHtml(item)}</label>` +
        `<select id="path-${index}" data-path="${escapeAttr(key)}">` +
        `<option value="unknown" ${saved === "unknown" ? "selected" : ""}>Unknown</option>` +
        `<option value="yes" ${saved === "yes" ? "selected" : ""}>Exists</option>` +
        `<option value="no" ${saved === "no" ? "selected" : ""}>Missing</option></select></div>`
      );
    })
    .join("");
  const outcomes = collectOutcomeRequests(state.parsed, state.project.files)
    .map(
      (request, index) =>
        `<div class="sim-input"><label for="outcome-${index}">Line ${request.line + 1}: ` +
        `${escapeHtml(request.source)} ERRORLEVEL</label><input id="outcome-${index}" ` +
        `type="number" min="0" max="255" step="1" data-outcome="${escapeAttr(request.key)}" ` +
        `value="${escapeAttr(
          Object.hasOwn(scenario.outcomes, request.key)
            ? scenario.outcomes[request.key]
            : "",
        )}" ` +
        'placeholder="required when reached"></div>',
    )
    .join("");
  $("simulationInputs").innerHTML =
    variables +
    paths +
    (outcomes ? `<h3 class="sim-subhead">Flow outcomes</h3>${outcomes}` : "");
  const updateSimulation = (changedControl) => {
    if (
      changedControl.matches("[data-outcome]") &&
      !changedControl.checkValidity()
    ) {
      const invalidMessage =
        "Simulation input invalid: ERRORLEVEL must be an integer from 0 through 255.";
      changedControl.value = "";
      changedControl.setAttribute("aria-invalid", "true");
      collectSimulationValues(changedControl);
      recalculateTrace();
      renderDiagram();
      renderTraceView();
      updateTraceSummary();
      const saveCompletion = queueSave({ immediate: true });
      setMessage(invalidMessage, "error");
      void saveCompletion.then((result) => {
        if (
          result.status === "saved" &&
          changedControl.isConnected &&
          changedControl.getAttribute("aria-invalid") === "true"
        ) {
          setMessage(invalidMessage, "error");
        }
      });
      return;
    }
    changedControl.removeAttribute("aria-invalid");
    try {
      collectSimulationValues(changedControl);
    } catch (error) {
      setMessage(`Simulation input invalid: ${error.message}`, "error");
      return;
    }
    recalculateTrace();
    renderDiagram();
    renderTraceView();
    updateTraceSummary();
    queueSave();
    const changedVariable =
      changedControl.dataset.var || changedControl.dataset.custom;
    if (
      changedVariable === "config" &&
      state.parsed.configInfo?.menuDefault &&
      storedSimulationScenario().variables.config === ""
    ) {
      renderSimulationInputs();
    }
  };
  document.querySelectorAll("select[data-var]").forEach((select) => {
    select.onchange = () => {
      const custom = document.querySelector(
        `[data-custom="${CSS.escape(select.dataset.var)}"]`,
      );
      custom.classList.toggle("hidden", select.value !== "__custom");
      if (select.value === "__custom" && !custom.value) {
        custom.value = select.dataset.effective;
      }
      updateSimulation(select);
    };
  });
  document
    .querySelectorAll(
      "input[data-var], [data-custom], [data-path], [data-outcome]",
    )
    .forEach((control) => {
      control.oninput = () => updateSimulation(control);
    });
  updateTraceSummary();
}

function collectSimulationValues(changedControl) {
  const current = storedSimulationScenario();
  const variables = new Map(Object.entries(current.variables));
  const paths = new Map(Object.entries(current.paths));
  const outcomes = new Map(Object.entries(current.outcomes));
  document.querySelectorAll("[data-var]").forEach((control) => {
    if (
      control.dataset.derived === "true" &&
      changedControl !== control &&
      changedControl.dataset.custom !== control.dataset.var
    ) {
      return;
    }
    let value = control.value;
    if (control.tagName === "SELECT" && value === "__custom") {
      value = document.querySelector(
        `[data-custom="${CSS.escape(control.dataset.var)}"]`,
      ).value;
    }
    if (
      (value && value !== "__custom") ||
      (control.dataset.var === "config" && value === "")
    ) {
      variables.set(control.dataset.var, value);
    } else {
      variables.delete(control.dataset.var);
    }
  });
  document.querySelectorAll("[data-path]").forEach((select) => {
    if (select.value === "unknown") {
      paths.delete(select.dataset.path);
    } else {
      paths.set(select.dataset.path, select.value);
    }
  });
  document.querySelectorAll("[data-outcome]").forEach((input) => {
    if (input.value !== "") {
      outcomes.set(input.dataset.outcome, Number(input.value));
    } else {
      outcomes.delete(input.dataset.outcome);
    }
  });
  state.project = updateProjectSimulationScenario(state.project, {
    variables: Object.fromEntries(variables),
    paths: Object.fromEntries(paths),
    outcomes: Object.fromEntries(outcomes),
  });
  $("resetSimulation").disabled = !scenarioHasValues();
}

function updateTraceSummary() {
  $("traceSummary").textContent = state.parsed
    ? `${state.trace.filter((row) => row.event !== "label").length} executed steps · ${state.traceStop}`
    : "";
}

function renderTraceView() {
  const rows = state.trace
    .map(
      (row, index) =>
        `<tr class="trace-row" data-trace-block="${escapeAttr(row.blockId)}">` +
        `<td>${index + 1}</td><td>L${row.line}</td>` +
        `<td class="trace-event">${escapeHtml(row.event)}</td>` +
        `<td>${escapeHtml(row.text)}</td>` +
        `<td class="trace-result">${escapeHtml(row.result)}</td></tr>`,
    )
    .join("");
  $("traceView").innerHTML =
    `<h2>Execution trace</h2>` +
    `<p class="trace-summary">${escapeHtml(state.traceStop || "No trace.")}</p>` +
    '<table class="trace-table"><thead><tr><th>#</th><th>Line</th>' +
    "<th>Type</th><th>Source</th><th>Result</th></tr></thead>" +
    `<tbody>${rows || '<tr><td colspan="5">No trace yet.</td></tr>'}</tbody></table>`;
  document.querySelectorAll("[data-trace-block]").forEach((row) => {
    row.onclick = () => {
      state.view = "split";
      applyView();
      selectBlock(row.dataset.traceBlock);
    };
  });
}

function applyView() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("diagramView").classList.toggle(
    "hidden",
    !["diagram", "split"].includes(state.view),
  );
  $("sourceView").classList.toggle(
    "hidden",
    !["source", "split"].includes(state.view),
  );
  $("traceView").classList.toggle("hidden", state.view !== "trace");
}

function updateStatus() {
  $("statusText").textContent = state.parsed
    ? `${state.project.name} · ${state.currentFile} · ${state.parsed.blocks.length} lines · v${PRODUCT_VERSION} · development`
    : `${state.project.name} · v${PRODUCT_VERSION} · development`;
  const exportButton = $("exportBat");
  exportButton.disabled = !state.currentFile;
}

function diagnosticStatusLabel(status) {
  return (
    {
      attention: "Attention",
      checking: "Checking",
      error: "Error",
      healthy: "Healthy",
      idle: "Idle",
      saved: "Saved",
      saving: "Saving",
      unsaved: "Unsaved changes",
    }[status] || status
  );
}

function diagnosticCounts() {
  const pathWarnings = state.currentFile
    ? analyzeProjectPath(state.currentFile).warnings.length
    : 0;
  return {
    fileCount: Object.keys(state.project.files).length,
    validationCount: (state.parsed?.validations.length || 0) + pathWarnings,
  };
}

function diagnosticsContext() {
  return {
    productVersion: PRODUCT_VERSION,
    projectFormatVersion: PROJECT_FORMAT_VERSION,
    databaseVersion: DATABASE_VERSION,
    interpreterProfile: INTERPRETER_PROFILE,
    userAgent: globalThis.navigator?.userAgent || "",
    language: globalThis.navigator?.language || "",
    online: globalThis.navigator?.onLine !== false,
    ...diagnosticCounts(),
  };
}

function renderDiagnostics() {
  const snapshot = diagnostics.getSnapshot();
  const overall = diagnosticStatusLabel(snapshot.health);
  const button = $("openDiagnostics");
  button.className = `diagnostics-button ${snapshot.health}`;
  button.setAttribute("aria-label", `Diagnostics: ${overall}`);
  $("diagnosticsBadge").textContent = overall;

  const active = Object.entries(snapshot.subsystems).filter(([, value]) =>
    ["attention", "error"].includes(value.status),
  );
  $("diagnosticsOverall").className =
    `diagnostics-overall ${snapshot.health}`.trim();
  $("diagnosticsOverall").innerHTML =
    `<strong>${escapeHtml(overall)}</strong>` +
    (active.length
      ? `<ul>${active
          .map(
            ([name, value]) =>
              `<li><span>${escapeHtml(name)}</span>: ${escapeHtml(
                value.detail || diagnosticStatusLabel(value.status),
              )}</li>`,
          )
          .join("")}</ul>`
      : "<span>No active operational problems.</span>");

  $("diagnosticsSaveState").textContent = diagnosticStatusLabel(
    snapshot.subsystems.save.status,
  );
  $("diagnosticsLastSave").textContent = snapshot.lastSuccessfulSaveAt
    ? new Date(snapshot.lastSuccessfulSaveAt).toLocaleString()
    : "Not observed this session";
  $("diagnosticsStorageState").textContent = diagnosticStatusLabel(
    snapshot.subsystems.storage.status,
  );
  $("diagnosticsRetentionState").textContent = diagnosticStatusLabel(
    snapshot.subsystems.retention.status,
  );
  $("diagnosticsVersions").innerHTML = [
    ["Product", PRODUCT_VERSION],
    ["Project format", PROJECT_FORMAT_VERSION],
    ["IndexedDB schema", DATABASE_VERSION],
    ["Diagnostics format", DIAGNOSTICS_FORMAT_VERSION],
    ["Interpreter", INTERPRETER_PROFILE],
  ]
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");
  $("diagnosticsEvents").innerHTML = snapshot.events.length
    ? [...snapshot.events]
        .reverse()
        .map(
          (event) =>
            `<article class="diagnostic-event ${escapeAttr(event.severity)}">` +
            `<div><span class="diagnostic-severity">${escapeHtml(
              event.severity,
            )}</span>` +
            `<time datetime="${escapeAttr(event.at)}">${escapeHtml(
              new Date(event.at).toLocaleString(),
            )}</time></div>` +
            `<strong>${escapeHtml(event.summary)}</strong>` +
            `<code>${escapeHtml(event.code)}</code>` +
            (event.detail
              ? `<details><summary>Technical details</summary><pre>${escapeHtml(
                  event.detail,
                )}</pre></details>`
              : "") +
            "</article>",
        )
        .join("")
    : '<p class="empty-state">No session events recorded.</p>';
  $("clearDiagnostics").disabled = snapshot.events.length === 0;
}

function download(name, content, type = "text/plain") {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function resetImportDialog() {
  state.pendingImport = null;
  $("importSummary").textContent =
    "Browse for source files, a source folder, or one BATFlow project.";
  $("importPreview").innerHTML = "";
  $("importError").textContent = "";
  $("confirmImport").disabled = true;
  $("folderRootChoice").classList.add("hidden");
  document
    .querySelectorAll('input[name="folderRoot"]')
    .forEach((radio) => (radio.checked = false));
}

function importedPath(record, rootMode) {
  if (!record.fromFolder || rootMode === "keep") return record.rawPath;
  const parts = record.rawPath.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : record.rawPath;
}

function projectDirectoryKey(path) {
  const parts = String(path ?? "")
    .replace(/\\/g, "/")
    .split("/");
  parts.pop();
  return parts.join("/").toLowerCase();
}

function validKeepDestination(sourcePath, destination) {
  const analysis = analyzeProjectPath(destination);
  const filename = String(destination ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .at(-1);
  return (
    analysis.safe &&
    analysis.supportedType &&
    projectDirectoryKey(destination) === projectDirectoryKey(sourcePath) &&
    analyzeProjectPath(filename).dos83Compliant
  );
}

function renderImportPreview() {
  const pending = state.pendingImport;
  if (!pending) return;
  $("importError").textContent = "";
  if (pending.kind === "project") {
    const warnings = Object.keys(pending.imported.project.files).filter(
      (path) => analyzeProjectPath(path).warnings.length,
    ).length;
    $("importSummary").textContent = `${
      projectHasWork() ? "This will replace the open project. " : ""
    }${pending.imported.project.name} · ${
      Object.keys(pending.imported.project.files).length
    } files${warnings ? ` · ${warnings} path warnings` : ""}`;
    $("importPreview").innerHTML = "";
    $("confirmImport").disabled = false;
    return;
  }
  if (pending.fromFolder && !pending.rootMode) {
    $("importSummary").textContent =
      "Choose how the selected folder should appear in the project.";
    $("importPreview").innerHTML = "";
    $("confirmImport").disabled = true;
    return;
  }

  let temporary = state.project;
  const resolved = [];
  for (const record of pending.records) {
    const path = importedPath(record, pending.rootMode);
    const existing = findProjectPath(temporary, path);
    const conflict = Boolean(existing);
    let action = conflict ? record.action || "" : "import";
    let destination = path;
    let error = "";
    if (action === "replace") destination = existing;
    if (action === "keep") {
      destination =
        record.customDestination ||
        record.suggestedDestination ||
        uniqueDosProjectPath(temporary, path);
      record.suggestedDestination ||= destination;
      if (!validKeepDestination(path, destination)) {
        error =
          "Keep-both destinations must stay in the same directory and use a safe DOS 8.3 filename.";
      } else if (findProjectPath(temporary, destination)) {
        error = "Keep-both destination already exists.";
      }
    }
    if (!conflict) record.action = "";
    if (!error && action && action !== "skip") {
      try {
        temporary = addTextFile(temporary, destination, record.text, {
          replace: action === "replace",
        });
      } catch (caught) {
        error = caught.message;
      }
    }
    resolved.push({
      record,
      path,
      conflict,
      action,
      destination,
      error,
      analysis: analyzeProjectPath(path),
    });
  }
  pending.resolved = resolved;
  const unsupported = pending.skipped.length;
  $("importSummary").textContent =
    `${pending.records.length} supported source ${
      pending.records.length === 1 ? "file" : "files"
    } selected` +
    (unsupported
      ? ` · ${unsupported} unsupported ${
          unsupported === 1 ? "file" : "files"
        } will be skipped`
      : "");
  $("importPreview").innerHTML = resolved
    .map(
      (item, index) =>
        `<div class="import-row"><div>${escapeHtml(item.path)}</div>` +
        (item.conflict
          ? `<select data-import-action="${index}" aria-label="Collision action for ${escapeAttr(item.path)}">` +
            '<option value="">Choose action…</option>' +
            `<option value="replace" ${item.action === "replace" ? "selected" : ""}>Replace</option>` +
            `<option value="keep" ${item.action === "keep" ? "selected" : ""}>Keep both</option>` +
            `<option value="skip" ${item.action === "skip" ? "selected" : ""}>Skip</option></select>`
          : "<span>Import</span>") +
        (item.action === "keep"
          ? `<input class="keep-path" data-keep-path="${index}" value="${escapeAttr(item.destination)}" ` +
            `aria-label="Keep-both destination for ${escapeAttr(item.path)}">`
          : "") +
        item.analysis.warnings
          .map(
            (warning) =>
              `<div class="import-row-warning">${escapeHtml(warning)} · imported unchanged</div>`,
          )
          .join("") +
        (item.error
          ? `<div class="import-row-warning">${escapeHtml(item.error)}</div>`
          : "") +
        "</div>",
    )
    .join("");
  document.querySelectorAll("[data-import-action]").forEach((select) => {
    select.onchange = () => {
      const item = resolved[Number(select.dataset.importAction)];
      item.record.action = select.value;
      if (select.value !== "keep") item.record.customDestination = "";
      renderImportPreview();
    };
  });
  document.querySelectorAll("[data-keep-path]").forEach((input) => {
    input.onchange = () => {
      const item = resolved[Number(input.dataset.keepPath)];
      item.record.customDestination = input.value;
      renderImportPreview();
    };
  });
  $("confirmImport").disabled =
    !resolved.length ||
    resolved.some(
      (item) => item.error || (item.conflict && !item.record.action),
    );
}

async function prepareImport(fileList, { fromFolder = false } = {}) {
  const files = [...fileList];
  if (!files.length) return;
  state.pendingImport = null;
  $("importPreview").innerHTML = "";
  $("confirmImport").disabled = true;
  const projectFiles = files.filter((file) => /\.batflow$/i.test(file.name));
  if (projectFiles.length) {
    if (files.length !== 1 || fromFolder) {
      throw new ProjectFormatError(
        "Import a BATFlow project by itself, not with source files or a folder.",
      );
    }
    const text = decodeUtf8(await projectFiles[0].arrayBuffer());
    state.pendingImport = {
      kind: "project",
      imported: importProjectDocument(JSON.parse(text)),
    };
    renderImportPreview();
    return;
  }

  const supported = files.filter((file) =>
    /\.(?:bat|sys|txt)$/i.test(file.name),
  );
  const records = [];
  for (const file of supported) {
    records.push({
      rawPath: fromFolder ? file.webkitRelativePath || file.name : file.name,
      fromFolder,
      text: decodeUtf8(await file.arrayBuffer()),
      action: "",
      customDestination: "",
    });
  }
  state.pendingImport = {
    kind: "sources",
    fromFolder,
    rootMode: fromFolder ? null : "keep",
    records,
    skipped: files.filter((file) => !supported.includes(file)),
    resolved: [],
  };
  $("folderRootChoice").classList.toggle("hidden", !fromFolder);
  renderImportPreview();
}

function recordImportRejection(error) {
  recordDiagnostic({
    severity: "warning",
    subsystem: "runtime",
    code: "project.import.rejected",
    summary: "A project import was rejected.",
    detail: errorDetail(error),
  });
}

async function applyPendingImport() {
  const pending = state.pendingImport;
  if (!pending) return;
  if (pending.kind === "project") {
    const imported = pending.imported;
    state.project = imported.project;
    state.currentFile = entryFilePath();
    state.selectedId = null;
    $("importDialog").close();
    resetImportDialog();
    render();
    const saveResult = await queueSave({ immediate: true });
    const count = imported.discardedSimulationOutcomes;
    if (count) {
      recordDiagnostic({
        severity: "warning",
        subsystem: "runtime",
        code: "project.import.repaired",
        summary: "A project import required safe recovery.",
        detail: `Cleared ${count} out-of-range simulation ${
          count === 1 ? "outcome" : "outcomes"
        }.`,
      });
    }
    recordDiagnostic({
      severity: "info",
      subsystem: "runtime",
      code: "project.import.succeeded",
      summary: "Project import completed.",
      detail: imported.migrated
        ? `Upgraded ${imported.sourceFormat}.`
        : "Imported project format 2.",
    });
    const repairMessage = count
      ? `Project imported; cleared ${count} out-of-range simulation ${
          count === 1 ? "outcome" : "outcomes"
        }.`
      : "Project imported.";
    if (saveResult.status === "failed") {
      setMessage(
        `${repairMessage} Save failed: ${saveResult.error.message}`,
        "error",
      );
    } else if (count) {
      setMessage(`Saved · ${repairMessage}`, "success");
    } else if (saveResult.status === "saved") {
      setMessage(
        imported.migrated
          ? `Imported and upgraded ${imported.sourceFormat} to project format 2.`
          : "Project imported.",
        "success",
      );
    }
    return;
  }

  let project = state.project;
  let firstImported = null;
  for (const item of pending.resolved) {
    if (item.action === "skip") continue;
    project = addTextFile(project, item.destination, item.record.text, {
      replace: item.action === "replace",
    });
    firstImported ||= item.destination;
  }
  state.project = project;
  state.currentFile ||= entryFilePath() || firstImported;
  state.selectedId = null;
  const skipped = pending.skipped.length;
  const warningCount = pending.resolved.filter(
    (item) => item.analysis.warnings.length,
  ).length;
  $("importDialog").close();
  resetImportDialog();
  render();
  const saveResult = await queueSave({ immediate: true });
  recordDiagnostic({
    severity: "info",
    subsystem: "runtime",
    code: "project.import.succeeded",
    summary: "Project import completed.",
    detail: `${pending.resolved.length} source candidates; ${skipped} unsupported files skipped.`,
  });
  if (saveResult.status === "saved" && (skipped || warningCount)) {
    setMessage(
      `Saved · Import complete${
        skipped ? `; skipped ${skipped} unsupported files` : ""
      }${warningCount ? `; ${warningCount} path warnings` : ""}.`,
      "success",
    );
  }
}

$("openImport").onclick = () => {
  resetImportDialog();
  $("importDialog").showModal();
};
$("browseFiles").onclick = () => $("fileInput").click();
$("browseFolder").onclick = () => $("folderInput").click();
$("cancelImport").onclick = () => {
  $("importDialog").close();
  resetImportDialog();
};
$("fileInput").onchange = async (event) => {
  try {
    await prepareImport(event.target.files);
    if (!$("importDialog").open) $("importDialog").showModal();
  } catch (error) {
    recordImportRejection(error);
    $("importError").textContent = `Import failed: ${error.message}`;
    setMessage(`Import failed: ${error.message}`, "error");
    if (!$("importDialog").open) $("importDialog").showModal();
  } finally {
    event.target.value = "";
  }
};
$("folderInput").onchange = async (event) => {
  try {
    await prepareImport(event.target.files, { fromFolder: true });
  } catch (error) {
    recordImportRejection(error);
    $("importError").textContent = `Import failed: ${error.message}`;
    setMessage(`Import failed: ${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
};
document.querySelectorAll('input[name="folderRoot"]').forEach((radio) => {
  radio.onchange = () => {
    state.pendingImport.rootMode = radio.value;
    renderImportPreview();
  };
});
$("importForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await applyPendingImport();
  } catch (error) {
    recordImportRejection(error);
    $("importError").textContent = `Import failed: ${error.message}`;
    setMessage(`Import failed: ${error.message}`, "error");
  }
};

$("newProject").onclick = () => {
  $("newProjectName").value = "Untitled";
  $("newProjectWarning").textContent = projectHasWork()
    ? "Creating this project will discard the currently open project."
    : "";
  $("newProjectDialog").showModal();
};
$("cancelNewProject").onclick = () => $("newProjectDialog").close();
$("newProjectForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    state.project = createProject($("newProjectName").value.trim());
    state.currentFile = null;
    state.selectedId = null;
    $("newProjectDialog").close();
    render();
    await queueSave({ immediate: true });
  } catch (error) {
    $("newProjectWarning").textContent = error.message;
  }
};

$("projectName").onchange = () => {
  try {
    state.project = updateProjectName(state.project, $("projectName").value);
    renderFiles();
    updateStatus();
    queueSave();
  } catch (error) {
    $("projectName").value = state.project.name;
    setMessage(`Project name invalid: ${error.message}`, "error");
  }
};
$("projectName").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("projectName").blur();
  }
};

$("renameFile").onclick = () => {
  if (!state.currentFile) return;
  $("renameFilePath").value = state.currentFile;
  $("renameFileError").textContent = "";
  $("renameFileDialog").showModal();
};
$("cancelRenameFile").onclick = () => $("renameFileDialog").close();
$("renameFileForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const previousPath = state.currentFile;
    const nextPath = $("renameFilePath").value;
    state.project = renameProjectFile(state.project, previousPath, nextPath);
    state.currentFile = nextPath;
    state.selectedId = null;
    $("renameFileDialog").close();
    render();
    await queueSave({ immediate: true });
  } catch (error) {
    $("renameFileError").textContent = error.message;
  }
};

$("deleteFile").onclick = async () => {
  if (
    !state.currentFile ||
    !window.confirm(
      `Delete "${state.currentFile}" and its notes and simulation outcomes?`,
    )
  ) {
    return;
  }
  const deletedPath = state.currentFile;
  state.project = deleteProjectFile(state.project, deletedPath);
  state.currentFile = entryFilePath();
  state.selectedId = null;
  render();
  await queueSave({ immediate: true });
};

$("setEntryFile").onclick = async () => {
  const file = state.currentFile
    ? state.project.files[state.currentFile]
    : null;
  if (!file) return;
  state.project = setProjectEntryFile(state.project, file.id);
  renderFiles();
  await queueSave({ immediate: true });
};

function projectDownloadName(name) {
  const safe = [...String(name ?? "")]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character,
    )
    .join("")
    .replace(/[ .]+$/g, "")
    .trim();
  return `${safe || "project"}.batflow`;
}

$("openDiagnostics").onclick = () => {
  renderDiagnostics();
  $("diagnosticsDialog").showModal();
};

$("closeDiagnostics").onclick = () => $("diagnosticsDialog").close();

$("clearDiagnostics").onclick = () => {
  diagnostics.clearHistory();
  renderDiagnostics();
};

$("exportDiagnostics").onclick = () => {
  const document = createDiagnosticsDocument(
    diagnostics.getSnapshot(),
    diagnosticsContext(),
  );
  const stamp = document.createdAt
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  download(
    `batflow-diagnostics-${stamp}.json`,
    `${JSON.stringify(document, null, 2)}\n`,
    "application/json",
  );
};

$("exportProject").onclick = () => {
  download(
    projectDownloadName(state.project.name),
    serializeProject(state.project),
    "application/octet-stream",
  );
};

$("exportBat").onclick = () => {
  if (!state.currentFile) return;
  download(
    state.currentFile.split(/[\\/]/).pop(),
    state.project.files[state.currentFile].content,
  );
};

$("sourceView").oninput = () => {
  if (!state.currentFile) return;
  state.project = updateFileContent(
    state.project,
    state.currentFile,
    $("sourceView").value,
  );
  parseCurrent();
  recalculateTrace();
  renderDiagram();
  renderSimulationInputs();
  renderLabels();
  renderValidation();
  renderInspector();
  renderTraceView();
  updateStatus();
  queueSave();
};

$("traceToggle").onclick = () => {
  state.traceEnabled = !state.traceEnabled;
  $("traceToggle").setAttribute("aria-pressed", String(state.traceEnabled));
  $("traceToggle").textContent = state.traceEnabled
    ? "Trace: On"
    : "Trace: Off";
  $("traceToggle").classList.toggle("active", state.traceEnabled);
  recalculateTrace();
  renderDiagram();
  renderTraceView();
  updateTraceSummary();
};

$("resetSimulation").onclick = async () => {
  if (
    !scenarioHasValues() ||
    !window.confirm("Reset all simulation inputs for this project?")
  ) {
    return;
  }
  state.project = updateProjectSimulationScenario(state.project, {
    variables: {},
    paths: {},
    outcomes: {},
  });
  render();
  await queueSave({ immediate: true });
};

document.querySelectorAll("[data-view]").forEach((button) => {
  button.onclick = () => {
    state.view = button.dataset.view;
    applyView();
  };
});

globalThis.addEventListener(
  "error",
  (event) => {
    const resourceFailure = event.target && event.target !== globalThis;
    const detail = resourceFailure
      ? `${event.target.tagName || "Resource"}: ${
          event.target.src || event.target.href || "unknown"
        }`
      : errorDetail(event.error) || event.message;
    setDiagnosticSubsystem("runtime", "error", { detail });
    recordDiagnostic({
      severity: "error",
      subsystem: "runtime",
      code: resourceFailure ? "runtime.asset.failed" : "runtime.error",
      summary: resourceFailure
        ? "A runtime asset failed to load."
        : "An unexpected application error occurred.",
      detail,
    });
    setMessage(
      "Unexpected application error. Open Diagnostics for details.",
      "error",
    );
  },
  true,
);

globalThis.addEventListener("unhandledrejection", (event) => {
  const detail = errorDetail(event.reason) || String(event.reason ?? "");
  setDiagnosticSubsystem("runtime", "error", { detail });
  recordDiagnostic({
    severity: "error",
    subsystem: "runtime",
    code: "runtime.rejection",
    summary: "An unexpected asynchronous error occurred.",
    detail,
  });
  setMessage(
    "Unexpected asynchronous error. Open Diagnostics for details.",
    "error",
  );
});

if (earlyDiagnostics) {
  earlyDiagnostics.startupComplete = true;
  for (const event of earlyDiagnostics.events) {
    const code = [
      "runtime.asset.failed",
      "runtime.error",
      "runtime.rejection",
    ].includes(event.code)
      ? event.code
      : "runtime.event";
    setDiagnosticSubsystem("runtime", "error", { detail: event.detail });
    recordDiagnostic({
      severity: "error",
      subsystem: "runtime",
      code,
      detail: event.detail,
    });
  }
  earlyDiagnostics.events = [];
}

recordDiagnostic({
  severity: "info",
  subsystem: "runtime",
  code: "app.started",
  summary: "BATFlow started.",
});

try {
  const loaded = await loadCurrentProject();
  setDiagnosticSubsystem("storage", "healthy");
  recordDiagnostic({
    severity: "info",
    subsystem: "storage",
    code: "storage.load.succeeded",
    summary: "Browser project storage is available.",
  });
  if (loaded) {
    state.project = loaded.project;
    state.currentFile = entryFilePath();
    setDiagnosticSubsystem("save", "saved", {
      successfulAt:
        (loaded.migratedFrom || loaded.discardedSimulationOutcomes) &&
        loaded.repairPersisted,
    });
    if (loaded.discardedSimulationOutcomes) {
      const count = loaded.discardedSimulationOutcomes;
      recordDiagnostic({
        severity: "warning",
        subsystem: "storage",
        code: "storage.recovery.succeeded",
        summary: "Stored project data required safe recovery.",
        detail: `Cleared ${count} out-of-range simulation ${
          count === 1 ? "outcome" : "outcomes"
        }.`,
      });
      setMessage(
        `Recovered project and cleared ${count} out-of-range simulation ${
          count === 1 ? "outcome" : "outcomes"
        }.${
          loaded.repairPersisted
            ? ""
            : " The repaired project could not be saved."
        }`,
        loaded.repairPersisted ? "success" : "error",
      );
    } else if (loaded.migratedFrom) {
      recordDiagnostic({
        severity: loaded.repairPersisted ? "info" : "error",
        subsystem: "storage",
        code: loaded.repairPersisted
          ? "storage.migration.succeeded"
          : "storage.migration.failed",
        summary: loaded.repairPersisted
          ? "Stored project data was upgraded."
          : "An upgraded project could not be saved.",
        detail: `Source: ${loaded.migratedFrom}`,
      });
      setMessage(
        `Recovered project data from ${loaded.migratedFrom}.${
          loaded.repairPersisted
            ? ""
            : " The upgraded project could not be saved; reloading may change file identities."
        }`,
        loaded.repairPersisted ? "success" : "error",
      );
    }
    if (!loaded.repairPersisted) {
      const detail = "Recovered project changes are not persisted.";
      setDiagnosticSubsystem("storage", "error", { detail });
      setDiagnosticSubsystem("save", "error", { detail });
      if (loaded.discardedSimulationOutcomes) {
        recordDiagnostic({
          severity: "error",
          subsystem: "storage",
          code: "storage.migration.failed",
          summary: "An upgraded project could not be saved.",
          detail,
        });
      }
    }
  }
} catch (error) {
  setDiagnosticSubsystem("storage", "error", {
    detail: errorDetail(error),
  });
  setDiagnosticSubsystem("save", "error", {
    detail: "Project storage is unavailable.",
  });
  recordDiagnostic({
    severity: "error",
    subsystem: "storage",
    code: "storage.load.failed",
    summary: "Browser project storage could not be loaded.",
    detail: errorDetail(error),
  });
  setMessage(`Storage unavailable: ${error.message}`, "error");
}
render();
