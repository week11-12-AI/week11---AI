// 시작 시각을 저장해 새로고침하거나 탭이 백그라운드에 있어도 경과 시간을 계산한다.
export function elapsedAt(timer, now = Date.now()) {
  if (!timer) return 0;
  return timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
}

export function changeTimer(timer, running, now = Date.now()) {
  return { elapsedMs: elapsedAt(timer, now), startedAt: running ? now : null };
}

export function restoreTimer(timer) {
  if (!timer || !Number.isSafeInteger(timer.elapsedMs) || timer.elapsedMs < 0
    || !(timer.startedAt === null || (Number.isSafeInteger(timer.startedAt) && timer.startedAt > 0))) return null;
  return { elapsedMs: timer.elapsedMs, startedAt: timer.startedAt };
}

export function formatSeconds(milliseconds) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}초`;
}
