# 슬랙 글 ③ Phase 1 설계 + 검증 기준 (합의용)

Phase 1 설계랑 검증 기준 초안이에요. 구현 전에 합의하고 싶어서 올려요.
🗳️ 표시된 곳은 같이 정해야 하는 부분이에요. 댓글로 의견 주세요!

━━━━━━━━━━━━━━━━━━
📌 요구사항 해석 (과제 문서에 안 적힌 부분)
━━━━━━━━━━━━━━━━━━
• 테스트 영역 = HTML 코드를 고치는 textarea
  (근거: 품질 항목 "테스트 영역에 다양한 태그와 요소를 추가해" → 태그 추가는 코드 편집이 필요)
• Phase 1 페이지의 "사용자"는 diff를 시험하는 개발자(우리). 진짜 사용자 흐름(클릭 → setState)은 Phase 2

━━━━━━━━━━━━━━━━━━
🧩 Phase 1 설계
━━━━━━━━━━━━━━━━━━
```
① 페이지
  [실제 영역]          [테스트 영역 = textarea]
   화면처럼 보임          HTML 코드를 직접 고침
          [ ← ]  [ Patch ]  [ → ]

② 데이터 약속 (합의 완료 → 바꾸려면 다시 합의)
  VNode   { type, props, children }   예) { type:"p", props:{class:"a"}, children:["안녕"] }
  지시서   { op, path, ... }          예) { op:"TEXT", path:[0,0], value:"4" }
  op      CREATE / REMOVE / REPLACE / PROPS / TEXT
  path    루트부터 몇 번째 자식인지 ([0,0] = 첫 자식의 첫 자식)

③ 상태
  history  VDOM 스냅숏 배열 (Patch 때마다 한 장)
  index    지금 실제 영역이 history의 몇 번째인지 (책갈피)

④ 함수 6개 🗳️ 이름 확정 필요
  htmlToDom(글자) → DOM            domToVNode(DOM) → VNode
  createDom(VNode) → DOM           vnodeToHtml(VNode) → 글자
  diff(이전, 새) → 지시서[]         applyPatches(DOM, 지시서[]) → 실제 DOM 수정
  ※ diff·applyPatches는 textarea·history를 모르게 (Phase 2에서 그대로 재사용)

⑤ 버튼 흐름
  로드   실제 영역 → V0 → textarea에 글자로 / history=[V0], index=0
  Patch  textarea 글자 → DOM → Vnew
         diff(history[index], Vnew) → 지시서 → 실제 영역에 바뀐 곳만 반영
         history에 Vnew 추가, index + 1
         🗳️ ←로 되돌린 상태에서 Patch하면 그 뒤 기록은 지우기 (Ctrl+Z 후 새로 입력하면 Ctrl+Y 안 되는 것처럼)
  ← / →  지금 VDOM → index ∓ 1 → 목표 VDOM
         diff(지금, 목표) → 실제 영역 patch / textarea = 목표 글자

⭐ 불변식: history[index] = 실제 영역의 지금 모습
   (깨지면 diff가 이미 반영된 변경을 또 지시함. 예: 목록에 B가 두 번)
```

━━━━━━━━━━━━━━━━━━
✅ 검증 (무엇을 · 어떤 기준으로)
━━━━━━━━━━━━━━━━━━
```
1. 단위 테스트 (함수 하나씩, 코드로)
   domToVNode    글자 / 속성 / 중첩 / 속성 없음 → props:{}
   diff          op 5개 각각 + 바뀐 게 없으면 [] + 깊은 곳의 path가 정확한지
   applyPatches  op 5개 각각
   history       Patch / ← / → / 되돌린 뒤 Patch
   기준: 전부 통과
   ⭐ 핵심 기준: patch 후 domToVNode(실제 영역) == 새 VDOM  (불변식을 코드로 검사)
   🗳️ DOM이 필요한 테스트(applyPatches 등)를 어디서 돌릴지
      (a) 브라우저 test.html  (b) Node + jsdom (외부 라이브러리지만 개발용)

2. 기능 테스트 (페이지에서 직접, 눈으로) = 발표 시연 순서로도 사용
   CREATE  <li> 한 줄 추가       REMOVE   한 줄 삭제
   REPLACE <p> → <div>          PROPS    class 값 변경
   TEXT    3 → 4                ← / → 왕복, 되돌린 뒤 Patch
   기준: 실제 영역이 textarea 내용과 같은 모습
         + 바뀐 노드만 바뀜 (DevTools > Rendering > Paint flashing으로 확인)

3. 엣지 케이스 (최소 이것만)
   빈 textarea / 닫히지 않은 태그 / 줄바꿈·공백만 있는 글자
   속성 삭제 / 자식 여러 개 동시 삭제 / 글자 ↔ 태그 교체
   맨 처음에서 ←, 맨 끝에서 →
   🗳️ 줄바꿈·공백 글자를 VNode에 넣을지 버릴지

4. 설명 검사 (과제: "핵심 로직은 설명할 수 있어야")
   diff · applyPatches · history 중 무작위 줄 1개를 각자 자기 말로 설명
   기준: 셋 다 통과해야 merge

5. merge 기준 (각자 구현 중 무엇을 고를지)
   테스트 통과 → 설명 가능 → 더 단순한 코드 순
```
