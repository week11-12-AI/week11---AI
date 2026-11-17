export const storageKey = name => `mini-react:v1:${name}`;

export function createRunStorage(runId) {
  const available = runId && runId !== "__SERVER_RUN_ID__";
  const resetKey = storageKey(`reset:${runId}`);
  const currentGeneration = () => window.localStorage.getItem(resetKey) ?? "";
  let generation = "";
  try {
    if (available) generation = currentGeneration();
  } catch {
    // 브라우저 저장소를 쓸 수 없어도 페이지는 계속 동작한다.
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
        // 저장소 접근이 막혔거나 용량이 가득 차도 실험실은 계속 사용할 수 있다.
      }
    },
    reset(names) {
      try {
        if (!available) return;
        const previous = currentGeneration();
        const next = crypto.getRandomValues(new Uint32Array(4)).join("-");
        // 초기화와 저장이 겹쳐도 기존 탭은 이전 실행 ID의 키만 사용한다.
        window.localStorage.setItem(resetKey, next);
        for (const name of names) window.localStorage.removeItem(keyFor(name, previous));
      } catch {
        // 저장소를 쓸 수 없어도 새로고침하면 메모리의 상태는 초기화된다.
      }
    },
    wasReset(event) {
      return available && event.key === resetKey && event.newValue !== null && event.newValue !== generation;
    },
  };
}
