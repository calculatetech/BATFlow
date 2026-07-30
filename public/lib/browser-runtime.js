export const SHELL_REVISION = "0.5.4-dev.17";
export const PERSISTENCE_REQUESTED_KEY =
  "batflow:storage-persistence-requested:v1";

function safeStorage(value) {
  try {
    return value?.() || null;
  } catch {
    return null;
  }
}

function recordPersistenceMarker(options) {
  const candidates = options.markerStorages || [
    safeStorage(() => globalThis.localStorage),
    safeStorage(() => globalThis.sessionStorage),
  ];
  for (const storage of candidates) {
    if (!storage) continue;
    try {
      if (storage.getItem(PERSISTENCE_REQUESTED_KEY) === "1") {
        return { recorded: true, previous: true };
      }
      storage.setItem(PERSISTENCE_REQUESTED_KEY, "1");
      return { recorded: true, previous: false };
    } catch {
      // Try the next storage mechanism.
    }
  }
  return { recorded: false, previous: false };
}

export async function ensureStoragePersistence(options = {}) {
  const storageManager =
    options.storageManager === undefined
      ? globalThis.navigator?.storage
      : options.storageManager;
  if (
    !storageManager ||
    typeof storageManager.persisted !== "function" ||
    typeof storageManager.persist !== "function"
  ) {
    return {
      status: "unsupported",
      attempted: false,
      detail: "The StorageManager persistence API is unavailable.",
    };
  }

  let persisted;
  try {
    persisted = await storageManager.persisted();
  } catch (error) {
    return {
      status: "unknown",
      attempted: false,
      detail: error?.message || "Persistent-storage state could not be read.",
    };
  }
  if (persisted) {
    return {
      status: "persistent",
      attempted: false,
      detail: "Browser storage is persistent.",
    };
  }

  const marker = recordPersistenceMarker(options);
  if (!marker.recorded) {
    return {
      status: "best-effort",
      attempted: false,
      detail:
        "Storage remains best effort because a one-time request cannot be recorded safely.",
    };
  }
  if (marker.previous) {
    return {
      status: "best-effort",
      attempted: false,
      detail:
        "The browser retained best-effort storage after an earlier request.",
    };
  }
  try {
    const granted = await storageManager.persist();
    return {
      status: granted ? "persistent" : "best-effort",
      attempted: true,
      detail: granted
        ? "The browser granted persistent storage."
        : "The browser retained best-effort storage.",
    };
  } catch (error) {
    return {
      status: "best-effort",
      attempted: true,
      detail:
        error?.message ||
        "The persistent-storage request failed; storage remains best effort.",
    };
  }
}
