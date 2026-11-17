import { CHALLENGE } from "./challenge.js";

// 화면의 도전 시작·시간 측정·성공 확인·기록 저장·랭킹 조회를 서버 API로 연결한다.
export function createPuzzleAPI() {
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(path, { ...options, signal: options.signal ?? controller.signal,
        headers: { "Content-Type": "application/json" }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "요청을 처리하지 못했습니다.");
      return body;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("요청 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    start: (restartAttemptId) => request("/api/challenge/start", { method: "POST", body: JSON.stringify({ restartAttemptId }) }),
    begin: attemptId => request("/api/challenge/begin", { method: "POST", body: JSON.stringify({ attemptId }) }),
    finish: body => request("/api/challenge/finish", { method: "POST", body: JSON.stringify(body) }),
    ranking: () => request(`/api/puzzles/${CHALLENGE.id}/ranking`),
    submit: body => request("/api/records", { method: "POST", body: JSON.stringify(body) }),
  };
}
