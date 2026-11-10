# 체크리스트 — 지금 어디인지

함수 하나마다 같은 사이클을 돈다 (→ [templates/cycle-note.md](templates/cycle-note.md)):
**예측(내가) → 구현(AI) → 실행 비교 → 틀린 곳 파기 → 줄 1개 설명(내가) → 커밋**

## Phase 1 — Virtual DOM + diff
| | 함수 | 예측 | 구현 | 테스트 통과 | 설명 |
|---|---|---|---|---|---|
| 1 | `domToVNode` | ✅ 2개 (1개 깨짐 → 재귀) | ✅ | ✅ 4/4 | ✅ 3덩어리 + 호출 순서 |
| 2 | `htmlToDom` | ✅ 1개 (깨짐 → 브라우저는 너그럽다) | ✅ | ✅ 2/2 | — |
| 3 | `createDom` | ✅ 1개 (맞음: 왕복 일대일) | ✅ | ✅ 2/2 | — |
| 4 | `vnodeToHtml` | ✅ 1개 (맞음: 한 줄) | ✅ | ✅ 2/2 | — |
| 5 | `diff` | ✅ 6개 (4개 깨짐 → path 규칙) | ✅ | ✅ 8/8 (기대값 전부 내 판정) | ✅ 131줄 재귀 설명 |
| 6 | `applyPatches` | ✅ 2개 (바뀐 곳만 / 고친 뒤 = 새 VNode) | ✅ | ✅ 11/11 | ✅ findNode 반복 0번 설명 (PROPS는 한 줄 요약만) |
| 7 | history | ✅ 2개 (옛 미래 버림 / 처음에서 ← 그대로) | ✅ | ✅ 2/2 | ✅ commit의 `length = index + 1` |
| 8 | 페이지 버튼 연결 | ✅ ← 하면 편집기도 되돌림 | ✅ `app.js` | ✅ 브라우저에서 직접 | — |

**Phase 1 검증** ([slack-phase1-design-verify.md](slack-phase1-design-verify.md))
- [x] 단위: domToVNode (✅ 글자 / ✅ 속성 / ✅ 중첩 / ✅ 속성 없음 → `props: {}` / ✅ 들여쓰기 공백 버림 / ✅ 한 줄 공백 유지)
- [x] 단위: diff (op 5개 + 안 바뀌면 `[]` + 깊은 path + 여러 개 REMOVE는 뒤에서부터)
- [x] 단위: applyPatches (op 5개 + 속성 삭제 + 여러 개 REMOVE + 루트 REPLACE + 글자↔태그 + 안 바뀐 노드 유지)
- [ ] 단위: history (Patch / ← / → / 되돌린 뒤 Patch)
- [ ] ⭐ 불변식: patch 후 `domToVNode(실제 영역)` == 새 VNode
- [x] 기능: ✅ CREATE · ✅ REMOVE · ✅ REPLACE · ✅ PROPS · ✅ TEXT · ✅ ←/→ 왕복 (✅ Paint flashing: 바나나→딸기 때 화면 상자 안 한 줄만 번쩍임, 11/9)
- [ ] 엣지: 빈 textarea / 안 닫힌 태그 / 공백 글자 / 속성 삭제 / 여러 자식 동시 삭제 / 글자↔태그 / 처음에서 ← / 끝에서 →

## Phase 2 — 함수형 컴포넌트 + Hooks

### 한 사이클 (11/10 코치 피드백 뒤 확정 — 한 번 완주해 보는 게 목표)
| 단계 | 목적 | 누가 | 끝 조건 |
|---|---|---|---|
| 0 그림 | 이 기능이 **무엇을 왜** 하는지 안다 | Claude가 그림 먼저 | 내 말로 한 줄 |
| 1 예측 | 명세를 내가 정한다 (= 테스트 기대값) | 나 | 작은 입력 → 기대 출력 2~3개 |
| 2 구현 | 완성도 | AI | 코드 |
| 3 실행 비교 | 명세대로 도는지 검증 | 같이 | 테스트 통과, 깨진 곳은 원인 파기 |
| 4 핵심 설명 | 핵심만 줄 단위로 이해 (3단 분류: 핵심=설명 / 경계=테스트 / 주변=AI) | 나 | 핵심 줄 1개 설명 |
| 5 레드팀 | 예외 처리 (코치 지적) | AI가 깨는 입력 → 내가 판정 | 엣지 테스트 추가 |
| 6 커밋 + 기록 | 다음 사이클에 쓸 노하우 | 나 + AI | 커밋 + ai-log 3줄 |

### 진도
- [x] 계단 1~4: 버튼 → 상태 → 다시 그리기(Phase 1 블록) → FunctionComponent 상자 (`steps/`)
- [x] 계단 5-1: count를 `hooks` 배열로
- [ ] useState — 콘솔로 setCount·useCount 직접 만들기 → 정답지 `src/component.js`와 비교 → 테스트 → 설명 → 커밋
- [ ] useEffect — 사이클 0~6
- [ ] useMemo — 사이클 0~6
- [ ] 레드팀: diff / applyPatches / useState 깨는 입력 → 엣지 테스트 (아래 엣지 칸 채우기)
- [ ] 시연 페이지 (클릭 → 부분 갱신, 주제 자유)

## 마무리
- [ ] README 완성 (실제 React와 다른 점 포함)
- [ ] 핵심 설명 연습: diff · applyPatches · history · hooks를 AI 없이 내 말로
- [ ] AI 노하우 가설 판정 ([ai-log.md](ai-log.md))
- [ ] 4분 시연 리허설
- [ ] 11/12(목) 13:00 발표
