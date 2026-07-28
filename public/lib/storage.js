import {
  exportProjectDocument,
  importProjectDocument,
  validateProject,
} from "./project-format.js?v=0.5.1-dev";

export const DATABASE_NAME = "batflow";
export const DATABASE_VERSION = 1;
export const PROJECT_STORE = "projects";
export const CURRENT_PROJECT_KEY = "current";
export const LEGACY_DATABASE_NAMES = ["batflow-v1", "passes", "passes-v1"];

export class StorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "StorageError";
  }
}

let primaryConnectionPromise = null;

function openDatabase(factory, name, version = DATABASE_VERSION) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_STORE)) {
        request.result.createObjectStore(PROJECT_STORE);
      }
    };
    request.onblocked = () => {
      reject(
        new StorageError(
          `Database upgrade for ${name} is blocked by another BATFlow tab.`,
        ),
      );
    };
    request.onerror = () => {
      reject(
        new StorageError(`Could not open database ${name}.`, request.error),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function primaryDatabase(factory) {
  if (!primaryConnectionPromise) {
    primaryConnectionPromise = openDatabase(factory, DATABASE_NAME).catch(
      (error) => {
        primaryConnectionPromise = null;
        throw error;
      },
    );
  }
  return primaryConnectionPromise;
}

function transactionRequest(database, mode, operation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const transaction = database.transaction(PROJECT_STORE, mode);
    const store = transaction.objectStore(PROJECT_STORE);
    const request = operation(store);
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new StorageError("IndexedDB request failed.", request.error));
      }
    };
    transaction.onabort = () => {
      if (!settled) {
        settled = true;
        reject(
          new StorageError(
            "IndexedDB transaction was aborted.",
            transaction.error,
          ),
        );
      }
    };
    transaction.onerror = () => {
      if (!settled) {
        settled = true;
        reject(
          new StorageError("IndexedDB transaction failed.", transaction.error),
        );
      }
    };
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(request.result);
      }
    };
  });
}

async function readCurrent(database) {
  if (!database.objectStoreNames.contains(PROJECT_STORE)) return null;
  return transactionRequest(database, "readonly", (store) =>
    store.get(CURRENT_PROJECT_KEY),
  );
}

async function writeCurrent(database, value) {
  await transactionRequest(database, "readwrite", (store) =>
    store.put(value, CURRENT_PROJECT_KEY),
  );
}

async function existingDatabaseNames(factory) {
  if (typeof factory.databases !== "function") return null;
  try {
    return new Set(
      (await factory.databases()).map((item) => item.name).filter(Boolean),
    );
  } catch {
    return null;
  }
}

async function loadLegacyProject(factory) {
  const existing = await existingDatabaseNames(factory);
  for (const name of LEGACY_DATABASE_NAMES) {
    if (existing && !existing.has(name)) continue;
    let database;
    try {
      database = await openDatabase(factory, name);
      const raw = await readCurrent(database);
      if (!raw) continue;
      return {
        ...importProjectDocument(raw),
        databaseName: name,
      };
    } catch {
      // A malformed or inaccessible legacy database must not block the primary
      // store. The caller will report an empty state and retain the legacy data.
    } finally {
      database?.close();
    }
  }
  return null;
}

export async function loadCurrentProject(options = {}) {
  const factory = options.indexedDB || globalThis.indexedDB;
  if (!factory) throw new StorageError("IndexedDB is not available.");

  const database = await primaryDatabase(factory);
  const raw = await readCurrent(database);
  if (raw) {
    const imported = importProjectDocument(raw);
    if (imported.migrated) {
      await writeCurrent(database, exportProjectDocument(imported.project));
    }
    return {
      project: imported.project,
      migratedFrom: imported.migrated ? imported.sourceFormat : null,
    };
  }

  const legacy = await loadLegacyProject(factory);
  if (!legacy) return null;
  await writeCurrent(database, exportProjectDocument(legacy.project));
  return {
    project: legacy.project,
    migratedFrom: legacy.databaseName,
  };
}

export async function saveCurrentProject(projectValue, options = {}) {
  const factory = options.indexedDB || globalThis.indexedDB;
  if (!factory) throw new StorageError("IndexedDB is not available.");
  const project = validateProject(projectValue);
  const database = await primaryDatabase(factory);
  await writeCurrent(database, exportProjectDocument(project));
  return project;
}

export async function resetStorageConnectionForTests() {
  if (primaryConnectionPromise) {
    try {
      (await primaryConnectionPromise).close();
    } catch {
      // Tests may reset after a deliberately failed open.
    }
  }
  primaryConnectionPromise = null;
}
