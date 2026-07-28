export function createSaveQueue(options) {
  const save = options.save;
  const onStatus = options.onStatus;
  const delay = options.delay ?? 350;
  const schedule = options.schedule || globalThis.setTimeout;
  const cancel = options.cancel || globalThis.clearTimeout;
  let timer = null;
  let chain = Promise.resolve();
  let revision = 0;

  function queue(snapshot, { immediate = false } = {}) {
    if (timer !== null) cancel(timer);
    timer = null;
    const queuedRevision = ++revision;

    const persist = () => {
      timer = null;
      if (queuedRevision === revision) onStatus("Saving…", "");
      const operation = chain
        .then(() => save(snapshot))
        .then(() => {
          const current = queuedRevision === revision && timer === null;
          if (current) {
            onStatus("Saved", "success");
          }
          return { status: current ? "saved" : "superseded" };
        })
        .catch((error) => {
          const current = queuedRevision === revision;
          if (current) {
            onStatus(`Save failed: ${error.message}`, "error");
          }
          return {
            status: current ? "failed" : "superseded",
            error,
          };
        });
      chain = operation.then(() => undefined);
      return operation;
    };

    if (immediate) return persist();
    timer = schedule(persist, delay);
    onStatus("Unsaved changes", "");
    return Promise.resolve({ status: "queued" });
  }

  return { queue };
}
