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
| 7 | history | ⬜ | ⬜ | ⬜ | ⬜ 핵심 |
| 8 | 페이지 버튼 연결 | — | ⬜ | ⬜ | — |

**Phase 1 검증** ([slack-phase1-design-verify.md](slack-phase1-design-verify.md))
- [x] 단위: domToVNode (✅ 글자 / ✅ 속성 / ✅ 중첩 / ✅ 속성 없음 → `props: {}` / ✅ 들여쓰기 공백 버림 / ✅ 한 줄 공백 유지)
- [x] 단위: diff (op 5개 + 안 바뀌면 `[]` + 깊은 path + 여러 개 REMOVE는 뒤에서부터)
- [x] 단위: applyPatches (op 5개 + 속성 삭제 + 여러 개 REMOVE + 루트 REPLACE + 글자↔태그 + 안 바뀐 노드 유지)
- [ ] 단위: history (Patch / ← / → / 되돌린 뒤 Patch)
- [ ] ⭐ 불변식: patch 후 `domToVNode(실제 영역)` == 새 VNode
- [ ] 기능: CREATE · REMOVE · REPLACE · PROPS · TEXT · ←/→ 왕복 (Paint flashing으로 바뀐 곳만 확인)
- [ ] 엣지: 빈 textarea / 안 닫힌 태그 / 공백 글자 / 속성 삭제 / 여러 자식 동시 삭제 / 글자↔태그 / 처음에서 ← / 끝에서 →

## Phase 2 — 함수형 컴포넌트 + Hooks
- [ ] Phase 2 설계 (예측 전에 데이터 약속부터)
- [ ] FunctionComponent
- [ ] useState — 클릭 → setState → 바뀐 부분만 갱신
- [ ] useEffect
- [ ] useMemo
- [ ] 시연 페이지

## 마무리
- [ ] README 완성 (실제 React와 다른 점 포함)
- [ ] 핵심 설명 연습: diff · applyPatches · history · hooks를 AI 없이 내 말로
- [ ] AI 노하우 가설 판정 ([ai-log.md](ai-log.md))
- [ ] 4분 시연 리허설
- [ ] 11/12(목) 13:00 발표
