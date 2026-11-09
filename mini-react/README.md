# mini-react

Vanilla JavaScript로 React의 핵심 원리(Virtual DOM, diff, patch, hooks)를 직접 만들어 보는 프로젝트.
크래프톤 정글 13기 11주차 · 개인 구현.

> 상태: **Phase 1 구현 중** (발표 전에 이 README를 완성한다)

## 목표
1. React 내부 원리를 **예측**하고 **설명**하고 **수정**할 수 있다.
2. AI를 쓰는 나만의 노하우를 찾는다 → [docs/ai-log.md](docs/ai-log.md)

## 실행
- 페이지: `index.html`을 VS Code에서 우클릭 → **Open with Live Server**
- 테스트: `tests/test.html`을 같은 방법으로 열고 브라우저 콘솔(F12)을 본다

## 흐름 (Phase 1)
```
HTML 글자 ──htmlToDom──▶ DOM ──domToVNode──▶ VNode
                                              │
              이전 VNode ─┐                    │
                          diff ──▶ patch 목록 ──applyPatches──▶ 실제 DOM (바뀐 곳만)
              새 VNode ───┘
```

## 함수
| 함수 | 입력 → 출력 | 상태 |
|---|---|---|
| `htmlToDom` | 글자 → DOM | ⬜ |
| `domToVNode` | DOM → VNode | ⬜ |
| `createDom` | VNode → DOM | ⬜ |
| `vnodeToHtml` | VNode → 글자 | ⬜ |
| `diff` | (이전, 새) → patch[] | ⬜ |
| `applyPatches` | (실제 영역, patch[]) → DOM 수정 | ⬜ |
| history | commit / back / forward / current | ⬜ |

## 폴더
```
mini-react/
├─ index.html          Phase 1 페이지
├─ src/main.js         구현
├─ tests/              브라우저 테스트
├─ CLAUDE.md           AI 작업 규칙
└─ docs/
   ├─ checklist.md     단계별 체크리스트 (지금 어디인지)
   ├─ progress.md      날짜별 진행
   ├─ ai-log.md        AI 사용 기록 + 노하우 가설
   ├─ templates/cycle-note.md  함수 하나당 노트 양식
   └─ (슬랙 글, 설계·검증 초안, AI 활용 방식)
```

## 실제 React와 다른 점
(발표 전에 채운다)
