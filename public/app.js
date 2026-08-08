import {
  highlightSource,
  readSourceFiles,
  serializeSource,
} from "./lib/source.js?v=0.6.0";
import { buildProgram } from "./lib/flow.js?v=0.6.0";
import { applySimulation, mountGraph } from "./lib/graph.js?v=0.6.0";
import { simulate } from "./lib/simulate.js?v=0.6.0";

const $ = (id) => document.getElementById(id);
const state = {
  files: new Map(),
  current: "",
  entry: "",
  view: "flow",
  revision: 0,
  program: null,
  graphRevision: -1,
  scenario: {},
  run: null,
};
let rebuildTimer;

function measured(name, action) {
  const start = performance.now();
  const result = action();
  performance.measure(name, { start, end: performance.now() });
  return result;
}

function setMessage(message, kind = "") {
  $("message").textContent = message;
  $("message").className = `message ${kind}`;
}

function hasDirtyFiles() {
  return [...state.files.values()].some((file) => file.dirty);
}

function selectedFile() {
  return state.files.get(state.current) || null;
}

function chooseEntry() {
  const paths = [...state.files.keys()];
  const autoexec = paths
    .filter((path) => /(^|\/)autoexec\.bat$/i.test(path))
    .sort((left, right) => left.split("/").length - right.split("/").length);
  return (
    autoexec[0] ||
    (paths.filter((path) => /\.bat$/i.test(path)).length === 1
      ? paths.find((path) => /\.bat$/i.test(path))
      : "")
  );
}

function renderFiles() {
  const files = [...state.files.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  $("fileCount").textContent = String(files.length);
  $("fileList").replaceChildren();
  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Open BAT and CONFIG.SYS files to begin.";
    $("fileList").append(empty);
  }
  for (const file of files) {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const flags = document.createElement("span");
    button.type = "button";
    button.className = `file-item ${file.key === state.current ? "active" : ""}`;
    button.dataset.file = file.key;
    name.className = "file-name";
    name.textContent = file.path;
    flags.className = "file-flags";
    flags.textContent = `${file.key === state.entry ? "◆" : ""}${file.dirty ? " ●" : ""}`;
    button.append(name, flags);
    button.addEventListener("click", () => {
      state.current = file.key;
      render();
    });
    $("fileList").append(button);
  }
}

function renderSource() {
  const file = selectedFile();
  $("sourceEditor").disabled = !file;
  $("sourceEditor").value = file?.text || "";
  $("sourceHighlight").innerHTML = file
    ? `${highlightSource(file.text)}\n`
    : "";
  $("sourceWarning").classList.toggle("hidden", !file?.mixed);
  $("sourceWarning").textContent = file?.mixed
    ? "Mixed line endings will download as CRLF."
    : "";
}

function rebuildProgram() {
  state.program = measured("batflow:program", () =>
    buildProgram(state.files, state.entry),
  );
  state.run = measured("batflow:simulate", () =>
    simulate(state.program, state.scenario),
  );
  const issues = state.program.diagnostics.length;
  $("diagnosticCount").textContent =
    `${issues} issue${issues === 1 ? "" : "s"}`;
  $("diagnosticCount").classList.toggle("warning", issues > 0);
  state.revision += 1;
  if (state.view === "flow") renderFlow();
}

function renderFlow() {
  if (state.graphRevision === state.revision) return;
  const program = state.program || buildProgram(state.files, state.entry);
  state.run ||= simulate(program, state.scenario);
  mountGraph($("flowView"), program, state.scenario, updateSimulation);
  applySimulation($("flowView"), state.run);
  state.graphRevision = state.revision;
}

function updateSimulation() {
  state.run = measured("batflow:simulate", () =>
    simulate(state.program, state.scenario),
  );
  applySimulation($("flowView"), state.run);
  renderExecuted();
}

function renderExecuted() {
  const rows = state.run?.executed || [];
  if (!rows.length) {
    $("executedView").innerHTML =
      '<div class="placeholder"><strong>No execution yet</strong><span>Open a batch program to simulate it.</span></div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "executed-code";
  table.innerHTML =
    "<thead><tr><th>Location</th><th>Executed source</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const location = document.createElement("td");
    const source = document.createElement("td");
    location.textContent = `${row.file}:${row.line}`;
    source.textContent = row.source;
    tr.append(location, source);
    body.append(tr);
  }
  if (state.run.warning) {
    const tr = document.createElement("tr");
    const location = document.createElement("td");
    const message = document.createElement("td");
    tr.className = "infinite-loop-warning";
    location.textContent = `${state.run.warning.file}:${state.run.warning.line}`;
    message.textContent = `Warning: ${state.run.warning.message}`;
    tr.append(location, message);
    body.append(tr);
  }
  table.append(body);
  $("executedView").replaceChildren(table);
}

function render() {
  renderFiles();
  renderSource();
  renderExecuted();
  if (state.view === "flow") renderFlow();
  const file = selectedFile();
  $("currentPath").textContent = file
    ? `${file.path}${file.key === state.entry ? " · entry" : ""}${file.dirty ? " · modified" : ""}`
    : "No file selected";
  $("setEntry").disabled = !file || !/\.bat$/i.test(file.path);
  $("downloadCurrent").disabled = !file;
  $("resetSession").disabled = state.files.size === 0;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  for (const view of ["flow", "source", "executed"]) {
    $(`${view}View`).classList.toggle("hidden", view !== state.view);
  }
  $("viewTitle").textContent =
    state.view === "executed"
      ? "Executed code"
      : state.view[0].toUpperCase() + state.view.slice(1);
}

async function openSources(fileList) {
  try {
    const sources = await readSourceFiles(fileList);
    const replacements = sources.filter((source) =>
      state.files.has(source.key),
    );
    if (
      replacements.some((source) => state.files.get(source.key).dirty) &&
      !globalThis.confirm("Replace modified files in this session?")
    ) {
      return;
    }
    for (const source of sources) state.files.set(source.key, source);
    state.current ||= sources[0].key;
    state.entry ||= chooseEntry();
    rebuildProgram();
    setMessage(
      `${sources.length} file${sources.length === 1 ? "" : "s"} opened`,
    );
    render();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  const revision = ++state.revision;
  rebuildTimer = setTimeout(() => {
    if (revision !== state.revision) return;
    rebuildProgram();
  }, 150);
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

$("openFiles").addEventListener("click", () => $("fileInput").click());
$("openFolder").addEventListener("click", () => $("folderInput").click());
$("fileInput").addEventListener("change", (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  void openSources(files);
});
$("folderInput").addEventListener("change", (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  void openSources(files);
});

$("setEntry").addEventListener("click", () => {
  if (!state.current) return;
  state.entry = state.current;
  rebuildProgram();
  setMessage(`${selectedFile().path} is the entry file`);
  render();
});

$("downloadCurrent").addEventListener("click", () => {
  const file = selectedFile();
  if (!file) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([serializeSource(file)], { type: "text/plain;charset=utf-8" }),
  );
  link.download = file.path.split("/").pop();
  link.click();
  URL.revokeObjectURL(link.href);
  file.dirty = false;
  setMessage(`${file.path} downloaded`);
  render();
});

$("resetSession").addEventListener("click", () => {
  if (hasDirtyFiles() && !globalThis.confirm("Discard modified files?")) return;
  state.files.clear();
  state.current = "";
  state.entry = "";
  state.revision += 1;
  state.program = null;
  state.graphRevision = -1;
  state.scenario = {};
  state.run = null;
  setMessage("Session reset");
  render();
});

$("sourceEditor").addEventListener("input", (event) => {
  const file = selectedFile();
  if (!file) return;
  file.text = event.target.value;
  file.dirty = true;
  $("sourceHighlight").innerHTML = `${highlightSource(file.text)}\n`;
  $("currentPath").textContent =
    `${file.path}${file.key === state.entry ? " · entry" : ""} · modified`;
  scheduleRebuild();
  renderFiles();
});

$("sourceEditor").addEventListener("scroll", (event) => {
  $("sourceHighlight").scrollTop = event.target.scrollTop;
  $("sourceHighlight").scrollLeft = event.target.scrollLeft;
});

globalThis.addEventListener("beforeunload", (event) => {
  if (!hasDirtyFiles()) return;
  event.preventDefault();
  event.returnValue = "";
});

globalThis.__batflow = state;
render();
