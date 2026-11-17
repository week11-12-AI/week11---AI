// 이 ID는 무작위로 다섯 칸을 눌러 만드는 도전 유형을 구분한다. 보드 배치는 매번 달라질 수 있다.
export const CHALLENGE = Object.freeze({ id: "challenge-01", title: "공통 도전 · 랜덤", scrambleSize: 5 });

export function createChallenge(attempt) {
  if (attempt?.id !== CHALLENGE.id || typeof attempt.attemptId !== "string" || !attempt.attemptId
    || !Array.isArray(attempt.scramble) || attempt.scramble.length !== 5
    || new Set(attempt.scramble).size !== 5
    || !attempt.scramble.every(index => Number.isInteger(index) && index >= 0 && index < 25)) {
    throw new Error("도전 정보를 불러오지 못했어요. 다시 시작하세요.");
  }
  return { version: 1, puzzleId: CHALLENGE.id, attemptId: attempt.attemptId,
    scramble: [...attempt.scramble], moves: [], cursor: 0, timer: { elapsedMs: 0, startedAt: null } };
}
