# 진행 상황

## 2026-11-06 (금) — 컨테이너 세션에서 넘어옴
- 개념: UI = f(state) / Virtual DOM vs 실제 DOM / diff → patch 목록 → applyPatches / history + index / 불변식
- Phase 1 설계를 끝냈다 (CLAUDE.md의 "Phase 1 설계"). 테스트 영역은 textarea로 정했다.
- 슬랙에 올렸다: 용어 4개와 데이터 약속, Phase 1 설계·검증 초안, 결정할 것 4개 (팀 답 대기).
- 팀 진행 방식: 각자 구현·검증하고, 가장 잘된 것을 제출해 발표한다.
- 아직 모름: 재귀 → 구현 뒤 console.log로 확인하기로 했다.
- 협업 규칙 1호: 공유는 넓게 하되 ✅/❔를 표시하고, 결정은 이해한 사람이 있을 때만 한다.

## 2026-11-07 (토)
- 레포 clone → `mini-react/` 뼈대 + 문서 → 첫 커밋, push (YoonJinhoon).
- 개념 5줄: 거의 필사로 씀 → 내일은 진짜 백지로.
- 결정: 테스트는 브라우저 test.html / 공백 글자는 JSX 규칙 (줄바꿈이 든 공백만 버림).
- AI 기록: 선택지를 받으면 "나중에 바꾸기 쉬워?"를 먼저 묻는다. 쉬우면 맡기고, 어려우면 이유를 이해할 때까지 묻는다.

## 2026-11-09 (월)
- 로컬 VSCode를 `week11---AI` 폴더로 열어 작업 (홈 폴더에서 열면 링크 경로가 깨짐). 지난 대화는 `~/.claude/projects/C--Users-User`에 남아 있다.
- `domToVNode` 완료: 테스트 4개 통과 (속성 / 재귀 / 들여쓰기 공백 버림 / 한 줄 공백 남김). 일부러 깨 보기로 테스트가 진짜 비교하는지 확인했다.
- 예측이 깨진 곳 2개: 자식 태그를 `"p"` 글자로 적음, 자식 VNode를 `[ ]`로 한 번 더 감쌈 → **children 목록의 한 칸 = 글자 하나 또는 VNode 상자 하나**.
- 재귀 호출 순서를 console.log 들여쓰기로 봤다 (test.js 아래쪽). 형제 순서 예측은 맞았다.
- PowerShell 프로필에 UTF-8 출력 설정 (터미널 한글 깨짐 해결).

- 변환 함수 3개 완료: `htmlToDom` (예측 깨짐: 틀린 HTML도 에러 없이 고쳐 읽음) / `createDom` (왕복 일대일, 맞음) / `vnodeToHtml` (한 줄, 맞음).

- 들여쓰기 설명 다시 들음: diff의 번호와 실제 DOM의 번호를 맞추려고 시작할 때 `createDom(V0)`로 다시 그린다.
- `diff` 구현 + 테스트 8개 통과. 예측 6개 중 4개 깨짐 → path 규칙 3개를 배움:
  - path는 번호가 하나여도 항상 목록 `[ ]`
  - 루트는 번호가 없다 (`[]`). 번호는 자식으로 내려갈 때만 붙는다
  - 바깥(루트)에서 안쪽 순서로 적는다 (`[1, 0]` = 1번 자식의 0번 자식)

- `diff` 줄 설명 통과 (131줄 재귀) + 전체 줄 읽기. 기대값 8개 전부 내가 판정.
- `applyPatches` 예측 2개 맞힘: (나) 바뀐 곳만 고친다 / 고친 뒤 실제 영역을 VNode로 바꾸면 = 새 VNode (불변식).
  - "싼 VDOM에서 비교하고, 비싼 실제 DOM은 바뀐 곳만 고친다" ← 발표용 한 줄
- `applyPatches` 구현 + 테스트 11개 (통과 29). **아직 커밋 안 함** (읽기 → 설명 → 커밋 순서).
- findNode 질문에서 깨짐 → 원인은 `for (const i of 목록)`을 몰랐던 것 (꺼낼 것 개수만큼 반복, 빈 목록이면 0번). 다시 물어서 맞힘: path `[]`이면 반복 0번 → `area.firstChild`(루트 요소) 그대로.
- 코드 읽기가 지쳐서 멈춤 → 쉬고 와서 이어 감.
- 남은 기대값 3개(htmlToDom 정상, createDom HTML 모양, vnodeToHtml 왕복) 판정 → 테스트 29개 기대값 전부 내 것.
- `applyPatches` 덩어리 읽기: TEXT / REPLACE / REMOVE / CREATE 통과. PROPS는 "새 목록과 똑같이 맞춘다" 한 줄만 (설명이 길어서 막힘 → 비약).
  - CREATE 규칙: **path의 마지막 숫자를 가린다 → 남은 것 = 부모, 가린 숫자 = 자리**. 순서를 뒤집거나 자리를 0으로 착각해서 두 번 깨짐.
  - `path[path.length - 1]`이 읽기 싫다 → `path.at(-1)`로 바꿈. `slice`는 "마지막 하나 빼기"로만 기억.

- `applyPatches` 커밋 + push (`30e3fe5`).
- `history` 예측 2개 맞힘 (← 뒤 Patch하면 옛 미래 버림 / 처음에서 ← 그대로) → 구현 + 테스트 (통과 31).
  - 줄 설명 통과: `h.list.length = h.index + 1` — 번호는 0부터라 지금 칸까지 남기려면 개수는 index + 1.
  - "서로 모른다" = history, diff, applyPatches가 독립된 레고 블록. 이어 붙이는 건 페이지 코드.

- 페이지 연결 (`src/app.js`) → **Phase 1 완성** (계획보다 하루 빠름).
  - Patch = 읽기 → 비교 → 고치기 → 저장 / ← → = 꺼내기 → 비교 → 고치기 → 편집기도 되돌리기
  - 화면 이름을 바꿈: 실제 영역 → 화면, 테스트 영역 → HTML 편집기
  - Paint flashing: 바나나→딸기 Patch 때 화면 상자 안에서 **한 줄만** 번쩍임 → (나) "바뀐 곳만 고친다"를 눈으로 확인. 발표 시연용.
- 지인 대화: "AI 코드를 보고 이해 못 하면 실력 없음" vs "주 1회 손코딩". 가설 5 후보 (백지에서 5줄 함수 써 보기) — 미정.

- 화면 검증 완료: CREATE / REMOVE / REPLACE / PROPS / ← 끝까지 → 처음 화면. **Phase 1 검증 끝.**
- 발표 형식 확인: 11/12 13:00, **README.md가 발표 자료** (슬라이드 없음), 4분 + 질문 1분, 팀 대표 1명. 목표: 대본 없이 README 그림을 보며 말하기.
- PC가 느려서 정리: WSL 끔 (VSCode 설정 `dev.containers.executeInWSL: false` — 처음에 "컨테이너로 들어가려는" 원인), Claude 데스크톱 앱·Edge 끔, VSCode 확장 27 → 7개. 대화가 길어서 새 대화로 넘어감 (11/9 저녁).

- (새 대화) 과제 원문을 받아 `docs/assignment.md`에 저장. Phase 1은 원문과 맞음. Phase 2 틀: `FunctionComponent` 클래스(hooks/mount/update), 상태·Hook은 루트에만, 자식은 props만.
- 팀: 수요일쯤 논의 전까지 **개인 플레이**로 진도. 2주에 과제 3개 (리액트 → 레디스 → DBMS). 기준은 내 학습과 성장.
- Phase 2 예측 2개 맞힘: +1 → 글자 하나만 고침 (TEXT `[0,0]`) / 변수만 바꾸면 화면은 그대로 → 누군가 다시 그려야 함 (= setState의 일).

- 예측 2개 더: `let count = 0`을 함수 안에 두면 매번 0부터 (예측 깨짐 → 스택 프레임) / 전역이면 유지 (맞음) / useState는 **부른 순서**로 칸을 찾음 / 다시 그려도 칸은 안 늘어남 (맞음).
- Claude가 Phase 2 코드를 먼저 다 써 버려서(`src/component.js` 등) 1~8 흐름이 전부 안 읽힘 → **계단 방식**으로 바꿈. 정답지 코드는 커밋 안 하고 둠.
  - 계단 1: onclick에 함수를 넘겨 두면 누를 때 실행 = `thread_create`의 함수 포인터 ✅
  - 계단 2: 상태 바꾸고 `draw()` ✅ 실험: draw를 빼면 count 11, 화면 0 → **setCount = 값 바꾸기 + 바뀐 값으로 다시 그리기** (한 줄 설명 통과)
  - 커밋: `a3ff1a2` 과제 원문, `6d5239b` 계단 1·2 (push 안 함)
- 배운 문법: `document` = 페이지 전체(DOM 트리 맨 위) / `getElementById("num")` = 이름표로 상자 찾기 / `.` = "~의" / `//` 주석 / textContent = 태그는 그대로, 안의 글자 노드만 바뀜 (= TEXT)
- AI 노하우 후보: 새 문법이 2개 이상 섞이면 계단, 조각을 다 알면 원래 사이클. 신호 = "정독했는데 안 들어온다". (판정 전)
- 저녁 끝: 지쳐서 글·코드가 안 읽힘 → 계단 3 예측 직전에 멈춤.
- 퇴근 30분 전: Claude가 쓴 블로그용 하루 정리를 정독 → "머릿속 정리 + 모르는 곳 파악"에 좋았다 (AI 노하우 후보).
  - 정독해 보니 **useState 3줄이 전부 이해 안 됨** (hooks 배열 / 부른 순서 = 칸 번호 / 0부터 다시 셈 / if 안 Hook 금지). Claude가 ✅로 잘못 표시했음 → 블로그에서는 ❔로.

## 2026-11-10 (화)
- 백지 그림 통과: 7단계 중 5개 맞음. 고친 곳 2개 — htmlToDom은 **임시** DOM (화면 DOM과 다름) / 수정된 DOM을 다시 VNode로 읽지 않고 VDOM_new를 history에 commit (아끼는 것: 비싼 실제 DOM 읽기). 함수 이름은 까먹음.
- 지인 조언: "생각을 코드로 바꾸는 훈련이 중요" → 지금까지는 코드 읽기만 했음 → 계단 3의 `draw()`를 **직접 씀** (가설 5 실험 시작).
- 계단 3 ✅ (`74c9f55`): 내 draw()는 commit(`oldVNode = newVNode`)을 빠뜨림 → -1 버튼으로 깨짐 (count 0, 화면 1, 지시서 `[]`) → 원인 찾아 한 줄로 고침.
  - view() = 상태로 설계도만 찍음 (printf의 빈칸 채우기, 화면 안 건드림) / draw() = 비교·고치기·저장.
  - view()는 인자가 없는데 왜 f(state)? → 바깥 count를 몰래 읽음 (좋은 지적). VNode ≠ UI (설계도 vs 화면).
  - DevTools Elements에서 `<p>`의 글자를 손으로 고쳐도 화면이 바뀜 → JS는 DOM만 고치고, 브라우저가 DOM을 보고 그린다.
- 계단 4 ✅ (`0c74789`): 흩어진 것을 `class FunctionComponent`로 (C 구조체 + 함수). firstDraw → mount(처음 붙이기), draw → update.
  - 설명 통과: `this.fn()` = Counter(). 51줄 `new`에서 함수를 값으로 넘겨 constructor가 fn 칸에 저장.
  - 문법: this = 인스턴스 자신 / constructor는 new 때 자동 1번 / 메서드는 function 안 씀 / 전역·지역 × let·const.
  - 실험: let/const 없이 쓴 `edit`이 draw() 실행 순간 **전역으로 몰래 생김** (누르기 전 not defined → 누른 뒤 보임).
- 흐름 내 말로: 버튼 → count 바뀜 → update()가 Counter()로 새 VNode → old와 비교해 지시서 → DOM 첨삭 → (브라우저가 다시 그림 = 우리 코드 밖의 별도 과정).

## 다음 — 11/10 (화) 순서 (Claude가 먼저 이끈다)
1. **10:00 백지 그림 (Phase 1, 기억만으로)**: 편집기 글자 → htmlToDom → 임시 DOM → domToVNode → 새 VNode / history의 지금 VNode → diff → 지시서 → applyPatches → 화면 DOM → commit → 브라우저가 바뀐 곳만 다시 그림. 막히는 화살표 = 모르는 곳.
2. **계단 3** (`steps/step3.html`, 만들어 둠, 미검증): `draw()` 속을 `view() → diff → applyPatches`로. 예측 질문부터: `div [ h3 ["카운터"], p ["0"] ]`에서 +1 → 지시서는? (사용자가 먼저 답)
3. **계단 4**: 상태를 상자(`class`)로 = FunctionComponent. 새 문법 class, this → **C 구조체로 그림 먼저**.
4. **계단 5 = 어제 이해 못 한 useState 3줄 검토** (그림 먼저, 실험으로 확인):
   - 5-1 상태 1개: 상자의 `hooks` 칸에 저장 → 다시 그려도 값 유지
   - 5-2 상태 2개: 이름이 아니라 **부른 순서**로 칸을 찾는다 (console.log로 칸 번호 찍기)
   - 5-3 번호를 0부터 다시 세는 줄을 빼 보기 → 칸이 늘어나는 걸 눈으로 보기
   - 5-4 ❔ Hook을 if 안에서 불러서 깨 보기 → 됐으면 ✅
   - 끝나면 정답지 `src/component.js`와 비교 → 테스트 → 커밋. 남은 깨진 테스트(버튼 onclick이 매번 새 함수 → PROPS)도 여기서.
5. 오후: useEffect → useMemo (되는 만큼) → README 초안.
6. **퇴근 30분 전: 하루 정리 정독** (오늘 효과 좋았음, 루틴으로).
- 11/11: 팀 논의·선정 → README 다듬기 → 4분 리허설.
