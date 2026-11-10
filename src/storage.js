export const storageKey = name => `mini-react:v1:${name}`;

export function createRunStorage(runId) {
  const available = runId && runId !== "__SERVER_RUN_ID__";
  return {
    read(name) {
      try {
        if (!available) return undefined;
        const entry = JSON.parse(window.localStorage.getItem(storageKey(name)));
        return entry?.runId === runId ? entry.value : undefined;
      } catch {
        return undefined;
      }
    },
    write(name, value) {
      try {
        if (available) window.localStorage.setItem(storageKey(name), JSON.stringify({ runId, value }));
      } catch {
        // The lab remains usable if browser storage is blocked or full.
      }
    },
  };
}
