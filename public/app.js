import {
  normalizeDosPath,
  norm,
  parseBatch,
  resolveBatchTarget,
} from "./lib/batch-core.js?v=0.5.4-dev.36";
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
} from "./lib/project-format.js?v=0.5.4-dev.36";
import {
  DATABASE_VERSION,
  loadCurrentProject,
  saveCurrentProject,
} from "./lib/storage.js?v=0.5.4-dev.36";
import { createSaveQueue } from "./lib/save-queue.js?v=0.5.4-dev.36";
import {
  DIAGNOSTICS_FORMAT_VERSION,
  createDiagnosticsDocument,
  createDiagnosticsStore,
} from "./lib/diagnostics.js?v=0.5.4-dev.36";
import {
  collectOutcomeRequests,
  simulate,
} from "./lib/simulation.js?v=0.5.4-dev.36";
import {
  SHELL_REVISION,
  ensureStoragePersistence,
} from "./lib/browser-runtime.js?v=0.5.4-dev.36";

const $ = (id) => document.getElementById(id);
const CONNECTIVITY_SESSION_KEY = "batflow:connectivity:offline:v1";
const OFFLINE_REGISTRATION_OPTIONS = {
  scope: "./",
  updateViaCache: "none",
};

function retainedOfflineState() {
  try {
    return globalThis.sessionStorage?.getItem(CONNECTIVITY_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

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
  offlineCache: "checking",
  offline: globalThis.navigator?.onLine === false || retainedOfflineState(),
  storageDurability: "unknown",
  activeShellRevision: SHELL_REVISION,
};
const diagnostics = createDiagnosticsStore();
const earlyDiagnostics = globalThis.__batflowEarlyDiagnostics;
let offlineRegistration = null;
let reloadForUpdate = false;
let updateActivationTimer = null;
let pendingUpdateWorker = null;
let connectivityProbeTimer = null;
let connectivityEpoch = 0;
let observedActiveWorker = null;
let observedActiveRevision = null;
let observedWaitingWorker = null;
let observedWaitingRevision = null;
let updateObservationCounter = 0;
let updateObservationToken = null;
const observedWorkerRevisions = new WeakMap();
let approvedUpdateRevision = null;
let workerStatusRequestCounter = 0;
let activeStatusRequestCounter = 0;
let activeStatusRequestId = null;
let updateApplicationCounter = 0;
let activeUpdateApplication = null;
let activeUpdateWorker = null;
let expectedUpdateController = null;
let recoverableUpdateController = null;
let recoverableUpdateRevision = null;
let terminalReloadAttempt = null;
let offlineCacheReadyRecorded = false;

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

async function saveLatestProjectForUpdate() {
  let result;
  do {
    result = await queueSave({ immediate: true });
  } while (result.status === "superseded");
  return result;
}

function renderConnectivity() {
  $("offlineStatus").classList.toggle("hidden", !state.offline);
}

async function originIsReachable() {
  try {
    const response = await fetch(
      `./service-worker.js?connectivity=${Date.now()}`,
      {
        cache: "no-store",
        method: "HEAD",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function scheduleConnectivityProbe() {
  if (!state.offline || connectivityProbeTimer !== null) return;
  connectivityProbeTimer = globalThis.setTimeout(async () => {
    connectivityProbeTimer = null;
    connectivityEpoch += 1;
    const probeEpoch = connectivityEpoch;
    const reachable = await originIsReachable();
    if (probeEpoch !== connectivityEpoch) return;
    if (reachable) {
      setConnectivity(false);
      void checkForShellUpdate();
    } else {
      scheduleConnectivityProbe();
    }
  }, 1000);
}

function setConnectivity(offline) {
  connectivityEpoch += 1;
  activeStatusRequestId = null;
  state.offline = Boolean(offline);
  try {
    if (state.offline) {
      globalThis.sessionStorage?.setItem(CONNECTIVITY_SESSION_KEY, "1");
    } else {
      globalThis.sessionStorage?.removeItem(CONNECTIVITY_SESSION_KEY);
    }
  } catch {
    // Connectivity still remains visible for the current document.
  }
  renderConnectivity();
  renderDiagnostics();
  if (state.offline) scheduleConnectivityProbe();
}

function setOfflineCacheState(status, detail) {
  state.offlineCache = status;
  setDiagnosticSubsystem(
    "cache",
    status === "ready"
      ? "healthy"
      : status === "checking"
        ? "checking"
        : "attention",
    { detail },
  );
}

function showAvailableUpdate(worker) {
  if (!worker || worker === pendingUpdateWorker) return;
  pendingUpdateWorker = worker;
  $("applyUpdate").classList.remove("hidden");
  recordDiagnostic({
    severity: "info",
    subsystem: "cache",
    code: "cache.update.ready",
    detail: "A newer offline shell is installed and waiting.",
  });
}

function restoreAvailableUpdate(worker = null, observe = true) {
  const candidate =
    offlineRegistration?.waiting ||
    (worker?.state === "installed" ? worker : null);
  pendingUpdateWorker = null;
  if (candidate) {
    if (observe) {
      observeAvailableUpdate(candidate);
    } else {
      pendingUpdateWorker = candidate;
      $("applyUpdate").classList.remove("hidden");
    }
  } else {
    $("applyUpdate").classList.add("hidden");
  }
}

function reconcileDuplicateWaitingWorker() {
  if (
    !observedActiveWorker ||
    !observedWaitingWorker ||
    typeof observedActiveRevision !== "string" ||
    typeof observedWaitingRevision !== "string" ||
    observedActiveRevision !== observedWaitingRevision
  ) {
    return;
  }
  const worker = observedWaitingWorker;
  try {
    worker.postMessage({ type: "BATFLOW_ACTIVATE" });
  } catch (error) {
    const currentWaiting = offlineRegistration?.waiting || null;
    pendingUpdateWorker = currentWaiting;
    $("applyUpdate").classList.toggle("hidden", !currentWaiting);
    if (currentWaiting && currentWaiting !== worker) {
      observeAvailableUpdate(currentWaiting);
    }
    recordDiagnostic({
      severity: "warning",
      subsystem: "cache",
      code: "cache.update.failed",
      detail: errorDetail(error),
    });
    return;
  }
  observedWaitingWorker = null;
  observedWaitingRevision = null;
  updateObservationToken = null;
  pendingUpdateWorker = null;
  $("applyUpdate").classList.add("hidden");
}

function observeAvailableUpdate(worker) {
  if (!worker) return;
  showAvailableUpdate(worker);
  const active =
    globalThis.navigator.serviceWorker.controller ||
    offlineRegistration?.active;
  const activeChanged = observedActiveWorker !== active;
  const waitingChanged = observedWaitingWorker !== worker;
  if (activeChanged) {
    observedActiveWorker = active;
    observedActiveRevision = null;
  }
  if (waitingChanged) {
    observedWaitingWorker = worker;
    observedWaitingRevision = null;
  }
  if (activeChanged || waitingChanged || updateObservationToken === null) {
    updateObservationCounter += 1;
    updateObservationToken = `update-${updateObservationCounter}`;
  }
  active?.postMessage({
    type: "BATFLOW_STATUS_REQUEST",
    requestId: `${updateObservationToken}:active`,
  });
  worker.postMessage({
    type: "BATFLOW_STATUS_REQUEST",
    requestId: `${updateObservationToken}:waiting`,
  });
}

function watchInstallingWorker(worker) {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed") {
      if (globalThis.navigator.serviceWorker.controller) {
        observeAvailableUpdate(offlineRegistration?.waiting || worker);
      }
      return;
    }
    if (worker.state !== "redundant") return;
    if (offlineRegistration?.active) {
      recordDiagnostic({
        severity: "warning",
        subsystem: "cache",
        code: "cache.update.failed",
        detail: "The existing offline shell remains active.",
      });
    } else {
      setOfflineCacheState(
        "failed",
        "The offline application shell could not be installed.",
      );
      recordDiagnostic({
        severity: "warning",
        subsystem: "cache",
        code: "cache.install.failed",
        detail: "The service worker installation became redundant.",
      });
    }
  });
}

function usesStableWorkerUrl(worker) {
  if (!worker?.scriptURL) return false;
  try {
    return new URL(worker.scriptURL).search === "";
  } catch {
    return false;
  }
}

function waitForStableWaitingWorker(registration) {
  const waiting = usesStableWorkerUrl(registration.waiting)
    ? registration.waiting
    : null;
  if (waiting) return Promise.resolve(waiting);
  const installing = registration.installing;
  if (!installing || !usesStableWorkerUrl(installing)) {
    return Promise.resolve(null);
  }
  if (installing.state === "installed") return Promise.resolve(installing);

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      installing.removeEventListener("statechange", handleStateChange);
      reject(new Error("Stable service-worker installation timed out."));
    }, 9000);
    const finish = (value, error) => {
      globalThis.clearTimeout(timeout);
      installing.removeEventListener("statechange", handleStateChange);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const handleStateChange = () => {
      if (installing.state === "installed") {
        finish(
          usesStableWorkerUrl(registration.waiting)
            ? registration.waiting
            : installing,
        );
      } else if (installing.state === "redundant") {
        finish(null, new Error("Stable service-worker installation failed."));
      }
    };
    installing.addEventListener("statechange", handleStateChange);
  });
}

function requestWorkerRevision(worker) {
  workerStatusRequestCounter += 1;
  const requestId = `revision-${workerStatusRequestCounter}`;
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      globalThis.navigator.serviceWorker.removeEventListener(
        "message",
        handleMessage,
      );
      reject(new Error("Service-worker revision check timed out."));
    }, 9000);
    const handleMessage = (event) => {
      if (
        event.data?.type !== "BATFLOW_STATUS" ||
        event.source !== worker ||
        (event.data.requestId !== requestId && event.data.requestId != null)
      ) {
        return;
      }
      globalThis.clearTimeout(timeout);
      globalThis.navigator.serviceWorker.removeEventListener(
        "message",
        handleMessage,
      );
      if (typeof event.data.shellRevision !== "string") {
        reject(new Error("Service-worker revision is unavailable."));
        return;
      }
      observedWorkerRevisions.set(worker, event.data.shellRevision);
      resolve(event.data.shellRevision);
    };
    globalThis.navigator.serviceWorker.addEventListener(
      "message",
      handleMessage,
    );
    worker.postMessage({ type: "BATFLOW_STATUS_REQUEST", requestId });
  });
}

async function activateStableWorkerBeforeReload(expectedRevision) {
  const controller = globalThis.navigator.serviceWorker.controller;
  if (!controller || usesStableWorkerUrl(controller)) return false;
  if (typeof expectedRevision !== "string") {
    throw new Error("The approved service-worker revision is unavailable.");
  }

  const registration = await globalThis.navigator.serviceWorker.register(
    "./service-worker.js",
    OFFLINE_REGISTRATION_OPTIONS,
  );
  offlineRegistration = registration;
  const stableWorker = await waitForStableWaitingWorker(registration);
  if (!stableWorker) {
    throw new Error("The stable service-worker registration is unavailable.");
  }
  const stableRevision = await requestWorkerRevision(stableWorker);
  if (stableRevision !== expectedRevision) {
    throw new Error(
      `Stable service-worker revision ${stableRevision} does not match approved revision ${expectedRevision}.`,
    );
  }
  const saveResult = await saveLatestProjectForUpdate();
  if (saveResult.status !== "saved") {
    throw new Error(
      "The latest project changes could not be saved before stable activation.",
    );
  }
  if (
    globalThis.navigator.serviceWorker.controller !== controller ||
    registration.waiting !== stableWorker
  ) {
    throw new Error(
      "The stable service-worker registration changed before activation.",
    );
  }
  expectedUpdateController = stableWorker;
  try {
    stableWorker.postMessage({ type: "BATFLOW_ACTIVATE" });
  } catch (error) {
    if (expectedUpdateController === stableWorker) {
      expectedUpdateController = null;
    }
    throw error;
  }
  pendingUpdateWorker = stableWorker;
  activeUpdateWorker = stableWorker;
  return true;
}

function beginUpdateApplication(worker = null) {
  if (activeUpdateApplication !== null) return null;
  updateApplicationCounter += 1;
  activeUpdateApplication = updateApplicationCounter;
  activeUpdateWorker = worker;
  $("applyUpdate").disabled = true;
  return activeUpdateApplication;
}

function finishUpdateApplication(attempt) {
  if (activeUpdateApplication !== attempt) return;
  activeUpdateApplication = null;
  activeUpdateWorker = null;
  if (terminalReloadAttempt === attempt) {
    terminalReloadAttempt = null;
  }
  $("applyUpdate").disabled = false;
}

function finishAlreadyActiveUpdate(attempt, worker) {
  const duplicateRevision = observedWorkerRevisions.get(worker);
  pendingUpdateWorker = null;
  $("applyUpdate").classList.add("hidden");
  finishUpdateApplication(attempt);
  if (duplicateRevision === SHELL_REVISION) {
    setMessage("Saved · update active", "success");
    return;
  }
  globalThis.location.reload();
}

function scheduleUpdateActivationFailure(attempt) {
  updateActivationTimer = globalThis.setTimeout(
    () => reportUpdateActivationFailure(attempt),
    10000,
  );
}

function reportUpdateActivationFailure(attempt) {
  if (activeUpdateApplication !== attempt) return;
  const timedOutController = expectedUpdateController;
  const timedOutRevision = approvedUpdateRevision;
  reloadForUpdate = false;
  approvedUpdateRevision = null;
  expectedUpdateController = null;
  recoverableUpdateController = timedOutController;
  recoverableUpdateRevision = timedOutRevision;
  updateActivationTimer = null;
  finishUpdateApplication(attempt);
  restoreAvailableUpdate(timedOutController, false);
  setMessage(
    "The update could not be activated. Your saved project remains open.",
    "error",
  );
  recordDiagnostic({
    severity: "warning",
    subsystem: "cache",
    code: "cache.update.failed",
    detail: "No service-worker controller change was observed.",
  });
}

function requestWorkerStatus() {
  const worker =
    globalThis.navigator.serviceWorker.controller ||
    offlineRegistration?.active;
  if (!worker) {
    activeStatusRequestId = null;
    return;
  }
  activeStatusRequestCounter += 1;
  activeStatusRequestId = `status-${activeStatusRequestCounter}`;
  worker.postMessage({
    type: "BATFLOW_STATUS_REQUEST",
    requestId: activeStatusRequestId,
  });
}

async function registerOfflineShell() {
  if (!("serviceWorker" in globalThis.navigator)) {
    setOfflineCacheState(
      "unavailable",
      "Service workers are unsupported in this browser or context.",
    );
    recordDiagnostic({
      severity: "warning",
      subsystem: "cache",
      code: "cache.install.failed",
      detail: "The Service Worker API is unavailable.",
    });
    return;
  }

  globalThis.navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "BATFLOW_STATUS") return;
    const requestId =
      typeof event.data.requestId === "string" ? event.data.requestId : null;
    const fromWaiting =
      event.source === observedWaitingWorker &&
      (requestId === `${updateObservationToken}:waiting` || requestId === null);
    if (fromWaiting) {
      observedWaitingRevision =
        typeof event.data.shellRevision === "string"
          ? event.data.shellRevision
          : null;
      if (observedWaitingRevision !== null) {
        observedWorkerRevisions.set(event.source, observedWaitingRevision);
      }
      reconcileDuplicateWaitingWorker();
      return;
    }
    const fromObservedActive =
      event.source === observedActiveWorker &&
      (requestId === `${updateObservationToken}:active` || requestId === null);
    if (fromObservedActive) {
      observedActiveRevision =
        typeof event.data.shellRevision === "string"
          ? event.data.shellRevision
          : null;
      if (observedActiveRevision !== null) {
        observedWorkerRevisions.set(event.source, observedActiveRevision);
      }
      reconcileDuplicateWaitingWorker();
      if (requestId !== null) return;
    }
    const activeWorker =
      globalThis.navigator.serviceWorker.controller ||
      offlineRegistration?.active;
    if (
      event.source !== activeWorker ||
      activeStatusRequestId === null ||
      (requestId !== null && requestId !== activeStatusRequestId)
    ) {
      return;
    }
    activeStatusRequestId = null;
    if (event.data.offline === true || !state.offline) {
      setConnectivity(event.data.offline);
    }
    state.activeShellRevision =
      typeof event.data.shellRevision === "string"
        ? event.data.shellRevision
        : SHELL_REVISION;
    if (event.data.cacheReady) {
      setOfflineCacheState("ready", `Ready · ${state.activeShellRevision}`);
      if (!offlineCacheReadyRecorded) {
        offlineCacheReadyRecorded = true;
        recordDiagnostic({
          severity: "info",
          subsystem: "cache",
          code: "cache.install.ready",
          detail: `Offline shell ${state.activeShellRevision} is ready.`,
        });
      }
    } else {
      setOfflineCacheState(
        "failed",
        "The offline application shell is incomplete.",
      );
    }
  });
  globalThis.navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      const controller =
        globalThis.navigator.serviceWorker.controller ||
        offlineRegistration?.active;
      if (
        !reloadForUpdate &&
        controller &&
        controller === recoverableUpdateController
      ) {
        const recoveredRevision = recoverableUpdateRevision;
        recoverableUpdateController = null;
        recoverableUpdateRevision = null;
        if (
          activeUpdateApplication !== null &&
          activeUpdateWorker !== controller
        ) {
          requestWorkerStatus();
          return;
        }
        pendingUpdateWorker = null;
        observedActiveWorker = controller;
        observedActiveRevision = null;
        observedWaitingWorker = null;
        observedWaitingRevision = null;
        updateObservationToken = null;
        $("applyUpdate").classList.add("hidden");
        let lateAttempt = activeUpdateApplication;
        if (lateAttempt === null) {
          lateAttempt = beginUpdateApplication(controller);
        }
        if (lateAttempt === null) {
          requestWorkerStatus();
          return;
        }
        terminalReloadAttempt = lateAttempt;
        if (!usesStableWorkerUrl(controller)) {
          reloadForUpdate = true;
          approvedUpdateRevision = recoveredRevision;
          void (async () => {
            try {
              const activatedStableWorker =
                await activateStableWorkerBeforeReload(recoveredRevision);
              if (activeUpdateApplication !== lateAttempt || !reloadForUpdate) {
                return;
              }
              if (!activatedStableWorker) {
                throw new Error(
                  "The stable service-worker registration was not activated.",
                );
              }
              scheduleUpdateActivationFailure(lateAttempt);
            } catch (error) {
              if (activeUpdateApplication !== lateAttempt || !reloadForUpdate) {
                return;
              }
              reloadForUpdate = false;
              approvedUpdateRevision = null;
              expectedUpdateController = null;
              finishUpdateApplication(lateAttempt);
              restoreAvailableUpdate();
              setMessage(
                "The update was saved, but its stable browser registration could not be completed.",
                "error",
              );
              recordDiagnostic({
                severity: "warning",
                subsystem: "cache",
                code: "cache.update.failed",
                detail: errorDetail(error),
              });
            }
          })();
          return;
        }
        void (async () => {
          const finalSaveResult = await saveLatestProjectForUpdate();
          if (activeUpdateApplication !== lateAttempt) {
            return;
          }
          if (globalThis.navigator.serviceWorker.controller !== controller) {
            finishUpdateApplication(lateAttempt);
            restoreAvailableUpdate();
            setMessage(
              "Reload was paused because the active browser update changed again. Your saved project remains open.",
              "error",
            );
            recordDiagnostic({
              severity: "warning",
              subsystem: "cache",
              code: "cache.update.failed",
              detail:
                "The service-worker controller changed during the late-activation save.",
            });
            return;
          }
          if (finalSaveResult.status !== "saved") {
            finishUpdateApplication(lateAttempt);
            setMessage(
              "The update is active, but reload was paused because the latest project changes could not be saved.",
              "error",
            );
            recordDiagnostic({
              severity: "warning",
              subsystem: "cache",
              code: "cache.update.failed",
              detail:
                "A late update activation was not reloaded because the latest project state was not saved.",
            });
            return;
          }
          finishUpdateApplication(lateAttempt);
          globalThis.location.reload();
        })();
        return;
      }
      if (
        !reloadForUpdate &&
        recoverableUpdateController !== null &&
        controller !== recoverableUpdateController
      ) {
        requestWorkerStatus();
        return;
      }
      if (
        !reloadForUpdate &&
        terminalReloadAttempt !== null &&
        controller !== activeUpdateWorker
      ) {
        const interruptedAttempt = terminalReloadAttempt;
        finishUpdateApplication(interruptedAttempt);
        restoreAvailableUpdate();
        setMessage(
          "Reload was paused because the active browser update changed again. Your saved project remains open.",
          "error",
        );
        recordDiagnostic({
          severity: "warning",
          subsystem: "cache",
          code: "cache.update.failed",
          detail:
            "The service-worker controller changed during the late-activation save.",
        });
        requestWorkerStatus();
        return;
      }
      if (
        reloadForUpdate &&
        controller !== expectedUpdateController &&
        recoverableUpdateController !== null
      ) {
        if (
          controller === recoverableUpdateController &&
          activeUpdateWorker !== controller
        ) {
          recoverableUpdateController = null;
          recoverableUpdateRevision = null;
          requestWorkerStatus();
          return;
        }
        if (
          activeUpdateWorker === recoverableUpdateController &&
          controller !== recoverableUpdateController
        ) {
          requestWorkerStatus();
          return;
        }
      }
      if (reloadForUpdate && controller !== expectedUpdateController) {
        const updateAttempt = activeUpdateApplication;
        if (updateActivationTimer !== null) {
          globalThis.clearTimeout(updateActivationTimer);
          updateActivationTimer = null;
        }
        reloadForUpdate = false;
        approvedUpdateRevision = null;
        expectedUpdateController = null;
        recoverableUpdateController = null;
        recoverableUpdateRevision = null;
        finishUpdateApplication(updateAttempt);
        restoreAvailableUpdate();
        setMessage(
          "The active browser update changed unexpectedly. Your saved project remains open.",
          "error",
        );
        recordDiagnostic({
          severity: "warning",
          subsystem: "cache",
          code: "cache.update.failed",
          detail:
            "A service-worker controller other than the approved update became active.",
        });
        requestWorkerStatus();
        return;
      }
      recoverableUpdateController = null;
      recoverableUpdateRevision = null;
      expectedUpdateController = null;
      pendingUpdateWorker = null;
      observedActiveWorker = controller;
      observedActiveRevision = null;
      observedWaitingWorker = null;
      observedWaitingRevision = null;
      updateObservationToken = null;
      $("applyUpdate").classList.add("hidden");
      if (reloadForUpdate) {
        const updateAttempt = activeUpdateApplication;
        if (updateActivationTimer !== null) {
          globalThis.clearTimeout(updateActivationTimer);
          updateActivationTimer = null;
        }
        void (async () => {
          try {
            const activatedStableWorker =
              await activateStableWorkerBeforeReload(approvedUpdateRevision);
            if (activeUpdateApplication !== updateAttempt || !reloadForUpdate) {
              return;
            }
            if (activatedStableWorker) {
              scheduleUpdateActivationFailure(updateAttempt);
              return;
            }
            const finalSaveResult = await saveLatestProjectForUpdate();
            if (
              activeUpdateApplication !== updateAttempt ||
              !reloadForUpdate ||
              globalThis.navigator.serviceWorker.controller !== controller
            ) {
              return;
            }
            if (finalSaveResult.status !== "saved") {
              reloadForUpdate = false;
              approvedUpdateRevision = null;
              expectedUpdateController = null;
              setMessage(
                "The update is active, but reload was paused because the latest project changes could not be saved.",
                "error",
              );
              recordDiagnostic({
                severity: "warning",
                subsystem: "cache",
                code: "cache.update.failed",
                detail:
                  "Terminal reload was suppressed because the latest project state was not saved.",
              });
              finishUpdateApplication(updateAttempt);
              return;
            }
            reloadForUpdate = false;
            approvedUpdateRevision = null;
            expectedUpdateController = null;
            finishUpdateApplication(updateAttempt);
            globalThis.location.reload();
          } catch (error) {
            if (activeUpdateApplication !== updateAttempt || !reloadForUpdate) {
              return;
            }
            reloadForUpdate = false;
            approvedUpdateRevision = null;
            expectedUpdateController = null;
            finishUpdateApplication(updateAttempt);
            restoreAvailableUpdate();
            setMessage(
              "The update was saved, but its stable browser registration could not be completed.",
              "error",
            );
            recordDiagnostic({
              severity: "warning",
              subsystem: "cache",
              code: "cache.update.failed",
              detail: errorDetail(error),
            });
          }
        })();
        return;
      }
      requestWorkerStatus();
    },
  );

  try {
    offlineRegistration = await globalThis.navigator.serviceWorker.register(
      "./service-worker.js",
      OFFLINE_REGISTRATION_OPTIONS,
    );
    offlineRegistration.addEventListener("updatefound", () =>
      watchInstallingWorker(offlineRegistration.installing),
    );
    watchInstallingWorker(offlineRegistration.installing);
    if (
      offlineRegistration.waiting &&
      globalThis.navigator.serviceWorker.controller
    ) {
      observeAvailableUpdate(offlineRegistration.waiting);
    }
    const ready = await globalThis.navigator.serviceWorker.ready;
    offlineRegistration = ready;
    setOfflineCacheState("checking", "Verifying the offline shell.");
    requestWorkerStatus();
  } catch (error) {
    setOfflineCacheState("failed", errorDetail(error));
    recordDiagnostic({
      severity: "warning",
      subsystem: "cache",
      code: "cache.install.failed",
      detail: errorDetail(error),
    });
  }
}

async function checkForShellUpdate() {
  if (!offlineRegistration || state.offline) return;
  try {
    await offlineRegistration.update();
    if (offlineRegistration.waiting) {
      observeAvailableUpdate(offlineRegistration.waiting);
    }
  } catch {
    connectivityEpoch += 1;
    const probeEpoch = connectivityEpoch;
    const reachable = await originIsReachable();
    if (probeEpoch === connectivityEpoch && !reachable) {
      setConnectivity(true);
    }
  }
}

async function initializeStorageDurability() {
  const result = await ensureStoragePersistence();
  state.storageDurability = result.status;
  const code =
    {
      "best-effort": "storage.persistence.best-effort",
      persistent: "storage.persistence.granted",
      unknown: "storage.persistence.unknown",
      unsupported: "storage.persistence.unsupported",
    }[result.status] || "storage.persistence.unknown";
  recordDiagnostic({
    severity: result.status === "unknown" ? "warning" : "info",
    subsystem: "storage",
    code,
    detail: result.detail,
  });
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
      "best-effort": "Best effort",
      failed: "Failed",
      persistent: "Persistent",
      ready: "Ready",
      saved: "Saved",
      saving: "Saving",
      unavailable: "Unavailable",
      unsaved: "Unsaved changes",
      unknown: "Unknown",
      unsupported: "Unsupported",
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
    online: !state.offline,
    offlineCache: state.offlineCache,
    storageDurability: state.storageDurability,
    shellRevision: state.activeShellRevision,
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
    ["attention", "checking", "error"].includes(value.status),
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
  $("diagnosticsDurabilityState").textContent = diagnosticStatusLabel(
    state.storageDurability,
  );
  $("diagnosticsCacheState").textContent =
    state.offlineCache === "ready"
      ? `Ready · ${state.activeShellRevision}`
      : diagnosticStatusLabel(state.offlineCache);
  $("diagnosticsRetentionState").textContent = diagnosticStatusLabel(
    snapshot.subsystems.retention.status,
  );
  $("diagnosticsVersions").innerHTML = [
    ["Product", PRODUCT_VERSION],
    ["Project format", PROJECT_FORMAT_VERSION],
    ["IndexedDB schema", DATABASE_VERSION],
    ["Diagnostics format", DIAGNOSTICS_FORMAT_VERSION],
    ["Interpreter", INTERPRETER_PROFILE],
    ["Offline shell", state.activeShellRevision],
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
  const saveResult = await saveLatestProjectForUpdate();
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

$("applyUpdate").onclick = async () => {
  const worker = offlineRegistration?.waiting || pendingUpdateWorker;
  if (!worker) {
    pendingUpdateWorker = null;
    $("applyUpdate").classList.add("hidden");
    return;
  }
  const updateAttempt = beginUpdateApplication(worker);
  if (updateAttempt === null) return;
  const saveResult = await saveLatestProjectForUpdate();
  if (saveResult.status !== "saved") {
    setMessage(
      "Update not applied because the current project could not be saved.",
      "error",
    );
    finishUpdateApplication(updateAttempt);
    return;
  }
  const currentController = globalThis.navigator.serviceWorker.controller;
  const currentWaiting = offlineRegistration?.waiting || pendingUpdateWorker;
  if (currentController === worker) {
    if (terminalReloadAttempt === updateAttempt) return;
    finishAlreadyActiveUpdate(updateAttempt, worker);
    return;
  }
  if (currentWaiting !== worker) {
    if (currentWaiting) {
      observeAvailableUpdate(currentWaiting);
      setMessage("Saved · a different update is ready for review.", "success");
    } else {
      pendingUpdateWorker = null;
      $("applyUpdate").classList.add("hidden");
    }
    finishUpdateApplication(updateAttempt);
    return;
  }
  let revision;
  try {
    revision =
      observedWaitingWorker === worker &&
      typeof observedWaitingRevision === "string"
        ? observedWaitingRevision
        : await requestWorkerRevision(worker);
  } catch (error) {
    setMessage(
      "Update not applied because its revision could not be verified.",
      "error",
    );
    recordDiagnostic({
      severity: "warning",
      subsystem: "cache",
      code: "cache.update.failed",
      detail: errorDetail(error),
    });
    finishUpdateApplication(updateAttempt);
    return;
  }
  const finalSaveResult = await saveLatestProjectForUpdate();
  if (finalSaveResult.status !== "saved") {
    setMessage(
      "Update not applied because the latest project changes could not be saved.",
      "error",
    );
    finishUpdateApplication(updateAttempt);
    return;
  }
  const finalController = globalThis.navigator.serviceWorker.controller;
  const finalWaiting = offlineRegistration?.waiting || pendingUpdateWorker;
  if (finalController === worker) {
    if (terminalReloadAttempt === updateAttempt) return;
    finishAlreadyActiveUpdate(updateAttempt, worker);
    return;
  }
  if (finalWaiting !== worker) {
    if (finalWaiting) {
      observeAvailableUpdate(finalWaiting);
      setMessage("Saved · a different update is ready for review.", "success");
    } else {
      pendingUpdateWorker = null;
      $("applyUpdate").classList.add("hidden");
    }
    finishUpdateApplication(updateAttempt);
    return;
  }
  approvedUpdateRevision = revision;
  reloadForUpdate = true;
  expectedUpdateController = worker;
  setMessage("Saved · applying update…", "success");
  try {
    worker.postMessage({ type: "BATFLOW_ACTIVATE" });
    scheduleUpdateActivationFailure(updateAttempt);
  } catch (error) {
    reloadForUpdate = false;
    approvedUpdateRevision = null;
    expectedUpdateController = null;
    finishUpdateApplication(updateAttempt);
    restoreAvailableUpdate(worker);
    setMessage(
      "The update could not be activated. Your saved project remains open.",
      "error",
    );
    recordDiagnostic({
      severity: "warning",
      subsystem: "cache",
      code: "cache.update.failed",
      detail: errorDetail(error),
    });
  }
};

renderConnectivity();
if (state.offline) scheduleConnectivityProbe();
globalThis.addEventListener("offline", () => setConnectivity(true));
globalThis.addEventListener("online", () => {
  connectivityEpoch += 1;
  activeStatusRequestId = null;
  if (state.offline) {
    scheduleConnectivityProbe();
  } else {
    void checkForShellUpdate();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void checkForShellUpdate();
  }
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
void registerOfflineShell();
void initializeStorageDurability();

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
