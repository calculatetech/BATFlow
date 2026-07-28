import {
  normalizeDosPath,
  norm,
  parseBatch,
  resolveBatchTarget,
} from "./lib/batch-core.js?v=0.5.1-dev";
import {
  PRODUCT_VERSION,
  ProjectFormatError,
  addTextFile,
  createProject,
  decodeUtf8,
  deleteProjectLine,
  duplicateProjectLine,
  importProjectDocument,
  serializeProject,
  updateFileContent,
  updateProjectSimulationScenario,
} from "./lib/project-format.js?v=0.5.1-dev";
import {
  loadCurrentProject,
  saveCurrentProject,
} from "./lib/storage.js?v=0.5.1-dev";
import { createSaveQueue } from "./lib/save-queue.js?v=0.5.1-dev";
import {
  collectOutcomeRequests,
  simulate,
} from "./lib/simulation.js?v=0.5.1-dev";

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
};

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

const projectSaveQueue = createSaveQueue({
  save: saveCurrentProject,
  onStatus: setMessage,
});

function projectHasWork() {
  return Object.keys(state.project.files).length > 0;
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
    lineIds: state.project.metadata.lineIds[state.currentFile],
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
}

function renderFiles() {
  const files = Object.keys(state.project.files);
  $("fileList").innerHTML = files.length
    ? files
        .map(
          (path) =>
            `<button class="file-item ${path === state.currentFile ? "active" : ""}" ` +
            `data-file="${escapeAttr(path)}" type="button">${escapeHtml(path)}</button>`,
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
  return state.project.metadata.notes[state.currentFile]?.[id] || "";
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
  state.project.metadata.notes[state.currentFile][block.id] = note;
  render();
  queueSave();
}

function renderValidation() {
  if (!state.parsed) {
    $("validation").innerHTML =
      '<div class="empty-state">No file selected.</div>';
    return;
  }
  $("validation").innerHTML = state.parsed.validations.length
    ? state.parsed.validations
        .map(
          (item) =>
            `<button class="validation-item ${item.severity === "error" ? "error" : ""}" ` +
            `data-validation-block="${escapeAttr(item.blockId)}" type="button">` +
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
    ? `${state.currentFile} · ${state.parsed.blocks.length} lines · v${PRODUCT_VERSION} · development`
    : `v${PRODUCT_VERSION} · development`;
  const exportButton = $("exportBat");
  exportButton.disabled = !state.currentFile;
}

function download(name, content, type = "text/plain") {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

async function importSelection(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const projectFiles = files.filter((file) => /\.batflow$/i.test(file.name));
  if (projectFiles.length) {
    if (files.length !== 1) {
      throw new ProjectFormatError(
        "Import a BATFlow project by itself, not with source files.",
      );
    }
    const text = decodeUtf8(await projectFiles[0].arrayBuffer());
    const imported = importProjectDocument(JSON.parse(text));
    if (
      projectHasWork() &&
      !window.confirm("Replace the current project with the imported project?")
    ) {
      return;
    }
    state.project = imported.project;
    state.currentFile = Object.keys(state.project.files)[0] || null;
    state.selectedId = null;
    render();
    const saveResult = await queueSave({ immediate: true });
    if (imported.discardedSimulationOutcomes) {
      const count = imported.discardedSimulationOutcomes;
      const repairMessage = `Project imported; cleared ${count} out-of-range simulation ${
        count === 1 ? "outcome" : "outcomes"
      }.`;
      if (saveResult.status === "failed") {
        setMessage(
          `${repairMessage} Save failed: ${saveResult.error.message}`,
          "error",
        );
      } else if (saveResult.status === "superseded") {
        setMessage(`Unsaved changes · ${repairMessage}`);
      } else {
        setMessage(`Saved · ${repairMessage}`, "success");
      }
    } else if (saveResult.status === "saved") {
      setMessage(
        imported.migrated
          ? "Imported and upgraded a legacy project."
          : "Project imported.",
        "success",
      );
    }
    return;
  }

  let nextProject = state.project;
  let firstImported = null;
  for (const file of files) {
    if (!/\.(?:bat|sys|txt)$/i.test(file.name)) {
      throw new ProjectFormatError(`Unsupported file type: ${file.name}`);
    }
    const path = file.webkitRelativePath || file.name;
    if (
      nextProject.files[path] &&
      !window.confirm(`Replace the existing project file "${path}"?`)
    ) {
      continue;
    }
    const text = decodeUtf8(await file.arrayBuffer());
    nextProject = addTextFile(nextProject, path, text);
    firstImported ||= path;
  }
  state.project = nextProject;
  state.currentFile ||= firstImported;
  render();
  await queueSave({ immediate: true });
}

$("fileInput").onchange = async (event) => {
  try {
    await importSelection(event.target.files);
  } catch (error) {
    setMessage(`Import failed: ${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
};

$("newProject").onclick = async () => {
  if (
    projectHasWork() &&
    !window.confirm("Discard the current project and create a new one?")
  ) {
    return;
  }
  state.project = createProject();
  state.currentFile = null;
  state.selectedId = null;
  render();
  await queueSave({ immediate: true });
};

$("exportProject").onclick = () => {
  download(
    `${state.project.name || "project"}.batflow`,
    serializeProject(state.project),
    "application/octet-stream",
  );
};

$("exportBat").onclick = () => {
  if (!state.currentFile) return;
  download(
    state.currentFile.split("/").pop(),
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

try {
  const loaded = await loadCurrentProject();
  if (loaded) {
    state.project = loaded.project;
    state.currentFile = Object.keys(state.project.files)[0] || null;
    if (loaded.discardedSimulationOutcomes) {
      const count = loaded.discardedSimulationOutcomes;
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
      setMessage(
        `Recovered project data from ${loaded.migratedFrom}.`,
        "success",
      );
    }
  }
} catch (error) {
  setMessage(`Storage unavailable: ${error.message}`, "error");
}
render();
