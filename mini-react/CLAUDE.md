# 미니 리액트 — Claude 작업 규칙

## 세션 시작 규칙
- `docs/progress.md`를 먼저 읽고 지난번 위치를 한 줄로 확인한 뒤 시작한다.
- 관련 자료: `docs/`에 있는 notes (슬랙 글, 설계·검증 초안, AI 활용 방식, 스케줄).

## 목표
1. 리액트의 원리를 본질적으로 이해한다. 기준: 돌리기 전에 결과를 **예측**하고, 증상에서 원인을 **설명**하고, 한 곳을 바꿀 때 영향 범위를 알고 **수정**한다.
2. AI를 잘 쓰는 법을 터득한다. 매일 3줄 기록: 상황 / AI를 어떻게 썼나 / 결과 → 다음엔.

## 사용자
- 정글 13기. PintOS에서는 스레드(동기화, 스케줄링)를 깊게 했다. JavaScript·브라우저는 초보다.
- 모르는 용어가 나오면 그 자리에서 2~3줄로 짚어 준다 ("📌 짚고 가기").
- 지치면 설명 크기부터 줄인다. 질문은 한 번에 하나만 한다.

## 모드
- **구현 = 결과 모드**: Claude가 코드를 쓴다.
- **예측·설명·검증 = 학습 모드**: Claude가 묻고 사용자가 답한다.
  - 함수 하나를 구현하기 전에 사용자가 "작은 입력 → 기대 출력"을 먼저 적는다. 이 예측이 테스트가 된다.
  - 구현한 뒤 실행해서 예측과 비교한다. 틀린 곳이 배울 곳이다.
  - 핵심 로직(diff, applyPatches, history, hooks)은 사용자가 줄 1개를 자기 말로 설명해야 통과다.
  - 재귀 같은 흐름은 말로 설명하지 말고 console.log(들여쓰기)로 실제 호출 순서를 보여 준다.
- 공유할 글에는 ✅(사용자가 설명 가능) / ❔(AI 초안, 미확인)을 표시한다.

## 제약
- Vanilla HTML / CSS / JavaScript만 쓴다. 외부 라이브러리와 프레임워크는 쓰지 않는다.
- 함수 하나 = 테스트 + 커밋 하나. 커밋 메시지에 무엇을, 왜 바꿨는지 적는다.

## 팀 데이터 약속 (바꾸려면 팀 합의 먼저)
- VNode: `{ type, props, children }`
  - 속성이 없으면 `props: {}`.
  - 글자 자식은 children 안에 **항상 문자열**로 넣는다 (숫자도 문자열로 바꿈).
- patch 목록: `[{ op, path, ... }]`
  - op: `CREATE` / `REMOVE` / `REPLACE` / `PROPS` / `TEXT` (대문자)
  - CREATE `{op, path, node}` · REMOVE `{op, path}` · REPLACE `{op, path, node}` · PROPS `{op, path, props}` · TEXT `{op, path, value}`
  - path: 루트에서 몇 번째 자식으로 내려가는지 적은 번호 목록. `[]` = 실제 영역 **안의** 루트 요소 1개.
- props 이름이 `on`으로 시작하면 (예: `onclick`) 속성이 아니라 이벤트 핸들러로 붙인다 (Phase 2 대비).

## 불변식
- `history[index]`는 항상 실제 영역 DOM과 같은 구조다.
- 실제 DOM을 바꾸는 함수는 `applyPatches` 하나뿐이다.
- `diff`와 `applyPatches`는 textarea와 history를 모른다 (Phase 2에서 그대로 재사용).

## Phase 1 설계 (개인 플레이로 확정)
- 페이지: [실제 영역] [테스트 영역 = HTML 코드를 고치는 textarea] [←] [Patch] [→]
- 함수:
  - `htmlToDom(글자)→DOM` · `domToVNode(DOM)→VNode` · `createDom(VNode)→DOM` · `vnodeToHtml(VNode)→글자`
  - `diff(이전, 새)→patch[]` · `applyPatches(실제영역, patch[])`
  - history: `commit` / `back` / `forward` / `current`
- 흐름:
  - 로드: 실제 영역 → V0 → textarea. history = [V0], index = 0.
  - Patch: textarea → DOM → Vnew. diff(history[index], Vnew) → applyPatches. index 뒤 기록을 버리고 Vnew를 추가, index + 1.
  - ← / →: 지금 VDOM → index ∓ 1 → 목표 VDOM. diff(지금, 목표) → applyPatches. textarea = 목표 글자.
- 개인 결정 (11/7, 개인 플레이로 바뀌어 혼자 정함):
  - DOM 테스트: 브라우저 `tests/test.html` (Live Server로 연다). Node·jsdom은 쓰지 않는다.
  - 공백 글자: React JSX와 같은 규칙. **줄바꿈이 든 공백 전용 글자는 버리고**, 한 줄 안의 공백(`" "`)은 남긴다.
    - 이 규칙은 `domToVNode` 한 곳에만 둔다.
    - 로드할 때 실제 영역을 `createDom(V0)`로 다시 그린다 (실제 DOM과 VNode의 자식 번호를 맞춰 불변식을 지키려고).
