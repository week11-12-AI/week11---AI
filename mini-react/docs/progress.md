# 진행 상황

## 2026-11-06 (금) — 컨테이너 세션에서 넘어옴
- 개념: UI = f(state) / Virtual DOM vs 실제 DOM / diff → patch 목록 → applyPatches / history + index / 불변식
- Phase 1 설계를 끝냈다 (CLAUDE.md의 "Phase 1 설계"). 테스트 영역은 textarea로 정했다.
- 슬랙에 올렸다: 용어 4개와 데이터 약속, Phase 1 설계·검증 초안, 결정할 것 4개 (팀 답 대기).
- 팀 진행 방식: 각자 구현·검증하고, 가장 잘된 것을 제출해 발표한다.
- 아직 모름: 재귀 → 구현 뒤 console.log로 확인하기로 했다.
- 협업 규칙 1호: 공유는 넓게 하되 ✅/❔를 표시하고, 결정은 이해한 사람이 있을 때만 한다.

## 다음
1. 아침에 백지 5줄 (개념 5개를 보지 않고 쓰기)
2. mini-react 뼈대 + 첫 커밋
3. 함수 하나씩: 예측 → AI 구현 → 실행 비교 (변환 함수 → diff → applyPatches)
