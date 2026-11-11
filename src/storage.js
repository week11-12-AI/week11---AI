export const storageKey = name => `mini-react:v1:${name}`;

export function createRunStorage(runId) {
  const available = runId && runId !== "__SERVER_RUN_ID__";
  const resetKey = storageKey(`reset:${runId}`);
  const currentGeneration = () => window.localStorage.getItem(resetKey) ?? "";
  let generation = "";
  try {
    if (available) generation = currentGeneration();
  } catch {
    // The page can still run without browser storage.
  }
  const keyFor = (name, version = generation) => storageKey(version ? `${runId}:${version}:${name}` : name);

  return {
    read(name) {
      try {
        if (!available) return undefined;
        const entry = JSON.parse(window.localStorage.getItem(keyFor(name)));
        return entry?.runId === runId ? entry.value : undefined;
      } catch {
        return undefined;
      }
    },
    write(name, value) {
      try {
        if (available && currentGeneration() === generation) {
          window.localStorage.setItem(keyFor(name), JSON.stringify({ runId, value }));
        }
      } catch {
        // The lab remains usable if browser storage is blocked or full.
      }
    },
    reset(names) {
      try {
        if (!available) return;
        const previous = currentGeneration();
        const next = crypto.getRandomValues(new Uint32Array(4)).join("-");
        // Old tabs keep their old keys even if a write races with the reset.
        window.localStorage.setItem(resetKey, next);
        for (const name of names) window.localStorage.removeItem(keyFor(name, previous));
      } catch {
        // Reloading still resets in-memory state when storage is unavailable.
      }
    },
    wasReset(event) {
      return available && event.key === resetKey && event.newValue !== null && event.newValue !== generation;
    },
  };
}
