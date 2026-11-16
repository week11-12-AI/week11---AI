// Persist timestamps, not interval ticks: refreshes and background tabs keep time.
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
