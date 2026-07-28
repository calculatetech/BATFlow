export const DIAGNOSTICS_FORMAT_VERSION = 1;
export const DIAGNOSTICS_SESSION_KEY = "batflow:diagnostics:v1";

const DEFAULT_MAX_EVENTS = 100;
const MAX_DETAIL_LENGTH = 4096;
const SUBSYSTEMS = ["runtime", "storage", "save", "retention"];
const HEALTH_STATES = ["healthy", "saving", "attention", "error"];
const SUBSYSTEM_STATES = {
  runtime: ["healthy", "error"],
  storage: ["checking", "healthy", "attention", "error"],
  save: ["idle", "unsaved", "saving", "saved", "error"],
  retention: ["healthy", "attention"],
};
const PUBLIC_SUMMARIES = {
  "app.started": "BATFlow started.",
  "diagnostics.retention.unavailable":
    "Session diagnostic history is unavailable.",
  "project.import.rejected": "A project import was rejected.",
  "project.import.repaired": "A project import required safe recovery.",
  "project.import.succeeded": "Project import completed.",
  "runtime.asset.failed": "A runtime asset failed to load.",
  "runtime.error": "An unexpected application error occurred.",
  "runtime.event": "An operational event occurred.",
  "runtime.rejection": "An unexpected asynchronous error occurred.",
  "storage.load.failed": "Browser project storage could not be loaded.",
  "storage.load.succeeded": "Browser project storage is available.",
  "storage.migration.failed": "An upgraded project could not be saved.",
  "storage.migration.succeeded": "Stored project data was upgraded.",
  "storage.recovery.succeeded": "Stored project data required safe recovery.",
  "storage.save.failed": "Project changes could not be saved.",
  "storage.save.recovered": "Project saving recovered.",
};

function isoNow(clock) {
  const value = clock();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function safeDetail(value) {
  return String(value ?? "").slice(0, MAX_DETAIL_LENGTH);
}

function normalizedTimestamp(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function normalizedCode(value) {
  return typeof value === "string" && Object.hasOwn(PUBLIC_SUMMARIES, value)
    ? value
    : null;
}

function normalizedState(value, allowed, fallback = "unknown") {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}

function normalizedEvent(value, index) {
  const at = normalizedTimestamp(value?.at);
  const code = normalizedCode(value?.code);
  if (!at || !code) return null;
  return {
    id: `diagnostic:${index + 1}`,
    at,
    severity: ["info", "warning", "error"].includes(value.severity)
      ? value.severity
      : "info",
    subsystem: SUBSYSTEMS.includes(value.subsystem)
      ? value.subsystem
      : "runtime",
    code,
    summary: PUBLIC_SUMMARIES[code],
    detail: safeDetail(value.detail),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialSubsystems() {
  return {
    runtime: { status: "healthy", detail: "" },
    storage: { status: "checking", detail: "" },
    save: { status: "idle", detail: "" },
    retention: { status: "healthy", detail: "" },
  };
}

function aggregateHealth(subsystems) {
  if (
    ["runtime", "storage", "save"].some(
      (name) => subsystems[name].status === "error",
    )
  ) {
    return "error";
  }
  if (["unsaved", "saving"].includes(subsystems.save.status)) {
    return "saving";
  }
  if (
    subsystems.retention.status === "attention" ||
    ["attention", "checking"].includes(subsystems.storage.status)
  ) {
    return "attention";
  }
  return "healthy";
}

function restoredState(storage) {
  if (!storage) return { events: [], lastSuccessfulSaveAt: null };
  const text = storage.getItem(DIAGNOSTICS_SESSION_KEY);
  if (!text) return { events: [], lastSuccessfulSaveAt: null };
  const value = JSON.parse(text);
  if (
    value?.formatVersion !== DIAGNOSTICS_FORMAT_VERSION ||
    !Array.isArray(value.events)
  ) {
    throw new TypeError("Unsupported session diagnostics data.");
  }
  return {
    events: value.events
      .map((event, index) => normalizedEvent(event, index))
      .filter(Boolean),
    lastSuccessfulSaveAt: normalizedTimestamp(value.lastSuccessfulSaveAt),
  };
}

export function createDiagnosticsStore(options = {}) {
  const clock = options.clock || (() => new Date());
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  let storage = options.storage;
  let retentionFailure = "";
  if (storage === undefined) {
    try {
      storage = globalThis.sessionStorage || null;
    } catch (error) {
      storage = null;
      retentionFailure = error.message;
    }
  }
  if (!storage && !retentionFailure) {
    retentionFailure = "sessionStorage is unavailable.";
  }

  let restored = { events: [], lastSuccessfulSaveAt: null };
  if (!retentionFailure) {
    try {
      restored = restoredState(storage);
    } catch (error) {
      retentionFailure = error.message;
    }
  }

  const state = {
    events: restored.events.slice(-maxEvents),
    lastSuccessfulSaveAt: restored.lastSuccessfulSaveAt,
    subsystems: initialSubsystems(),
  };
  let sequence = Math.max(
    0,
    ...state.events.map((event) => {
      const match = /^diagnostic:(\d+)$/.exec(event.id);
      return match ? Number(match[1]) : 0;
    }),
  );

  function snapshot() {
    return {
      health: aggregateHealth(state.subsystems),
      events: clone(state.events),
      lastSuccessfulSaveAt: state.lastSuccessfulSaveAt,
      subsystems: clone(state.subsystems),
    };
  }

  function persist() {
    if (!storage || state.subsystems.retention.status === "attention") return;
    try {
      storage.setItem(
        DIAGNOSTICS_SESSION_KEY,
        JSON.stringify({
          formatVersion: DIAGNOSTICS_FORMAT_VERSION,
          events: state.events,
          lastSuccessfulSaveAt: state.lastSuccessfulSaveAt,
        }),
      );
    } catch (error) {
      state.subsystems.retention = {
        status: "attention",
        detail: safeDetail(error.message),
      };
      state.events.push({
        id: `diagnostic:${++sequence}`,
        at: isoNow(clock),
        severity: "warning",
        subsystem: "retention",
        code: "diagnostics.retention.unavailable",
        summary: PUBLIC_SUMMARIES["diagnostics.retention.unavailable"],
        detail: safeDetail(error.message),
      });
      state.events = state.events.slice(-maxEvents);
    }
  }

  function record(event) {
    const code = normalizedCode(event.code) || "runtime.event";
    const item = {
      id: `diagnostic:${++sequence}`,
      at: normalizedTimestamp(event.at) || isoNow(clock),
      severity: ["info", "warning", "error"].includes(event.severity)
        ? event.severity
        : "info",
      subsystem: SUBSYSTEMS.includes(event.subsystem)
        ? event.subsystem
        : "runtime",
      code,
      summary: PUBLIC_SUMMARIES[code],
      detail: safeDetail(event.detail),
    };
    state.events.push(item);
    state.events = state.events.slice(-maxEvents);
    persist();
    return clone(item);
  }

  if (retentionFailure) {
    state.subsystems.retention = {
      status: "attention",
      detail: safeDetail(retentionFailure),
    };
    record({
      severity: "warning",
      subsystem: "retention",
      code: "diagnostics.retention.unavailable",
      summary: PUBLIC_SUMMARIES["diagnostics.retention.unavailable"],
      detail: retentionFailure,
    });
  }

  return {
    clearHistory() {
      state.events = [];
      persist();
      return snapshot();
    },
    getSnapshot: snapshot,
    record,
    setSubsystem(name, status, details = {}) {
      if (!SUBSYSTEMS.includes(name)) {
        throw new TypeError(`Unknown diagnostic subsystem: ${name}`);
      }
      state.subsystems[name] = {
        status,
        detail: safeDetail(details.detail),
      };
      if (name === "save" && details.successfulAt) {
        state.lastSuccessfulSaveAt =
          details.successfulAt === true
            ? isoNow(clock)
            : new Date(details.successfulAt).toISOString();
      }
      persist();
      return snapshot();
    },
  };
}

export function createDiagnosticsDocument(snapshot, context = {}) {
  const safeEvents = snapshot.events
    .map((event, index) => normalizedEvent(event, index))
    .filter(Boolean)
    .map(({ at, severity, subsystem, code }) => ({
      at,
      severity,
      subsystem,
      code,
      summary: PUBLIC_SUMMARIES[code],
    }));
  return {
    diagnosticsFormatVersion: DIAGNOSTICS_FORMAT_VERSION,
    createdAt: context.createdAt || new Date().toISOString(),
    createdBy: {
      product: "BATFlow",
      productVersion: context.productVersion,
    },
    versionDomains: {
      projectFormat: context.projectFormatVersion,
      indexedDbSchema: context.databaseVersion,
      interpreterProfile: context.interpreterProfile,
    },
    runtime: {
      userAgent: context.userAgent || "",
      language: context.language || "",
      online: context.online !== false,
    },
    health: {
      overall: normalizedState(snapshot.health, HEALTH_STATES),
      lastSuccessfulSaveAt: normalizedTimestamp(snapshot.lastSuccessfulSaveAt),
      subsystems: Object.fromEntries(
        SUBSYSTEMS.map((name) => [
          name,
          normalizedState(
            snapshot.subsystems[name]?.status,
            SUBSYSTEM_STATES[name],
          ),
        ]),
      ),
    },
    counts: {
      files: Number(context.fileCount) || 0,
      validations: Number(context.validationCount) || 0,
      events: safeEvents.length,
    },
    events: safeEvents,
  };
}
