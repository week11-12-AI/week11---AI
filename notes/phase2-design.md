# Phase 2 설계 초안 — Component · State · Hooks

2026-11-10 작성. 구현 전 검토용 설계다. 아래의 과제 조건과 사용자가 선택한 시연 주제·페이지 분리·JSX 사용·할 일 영속 저장·컴포넌트 역할 분리·Effect 시연 동작·종료 및 재시작 시연·학습 패널 제공·상태 갱신 묶음 처리는 확정이며, 나머지 API·파일 구성·실행 방식은 제안이다.

## 사용자와 결정한 설계 요약

| 항목 | 확정 내용 |
| --- | --- |
| 시연 앱 | 할 일 추가·완료·필터와 완료 개수 계산 |
| 페이지 | Phase 1·2를 분리하고 상호 이동 링크 제공 |
| 작성법 | JSX를 자체 VDOM 생성 함수로 변환 |
| 컴포넌트 | App + 역할별 자식 5종, 모든 State·Hook은 App에만 배치 |
| 저장 | 할 일·완료 상태만 브라우저에 저장; draft는 빈 값, filter는 전체로 초기화 |
| Effect | 저장과 탭 제목 변경·정리 |
| 생명주기 시연 | 앱 종료·다시 시작 버튼 제공 |
| 학습 패널 | 렌더링·Memo 계산 횟수 비교, 접기·펼치기 |
| 업데이트 | 연속 상태 변경을 묶어 한 번 렌더링 |

아래 API 이름, 파일 구성, 이벤트 리스너 관리, 오류 처리와 Hook 내부 자료구조는 이 선택을 만족시키기 위한 구현 제안이다. 사용자에게 보이는 동작이나 범위를 바꾸는 선택이 생기면 다시 한 항목씩 논의한다.

## 목표와 확정 범위

- 함수형 컴포넌트로 동작하는 할 일 목록 페이지를 만든다. 사용자가 추가·완료·필터와 완료 개수 계산 예제를 선택했다.
- 함수형 컴포넌트를 감싸는 `FunctionComponent` 클래스를 구현한다. `hooks` 배열, `mount()`, `update()`를 제공한다.
- State와 Hook은 루트 컴포넌트에서만 사용한다. 자식은 props만 사용하는 순수 함수로 만든다.
- `useState`, `useEffect`, `useMemo`를 직접 구현한다.
- 상태 변경은 새 VDOM 생성 → 기존 Diff → 기존 Patch로 화면에 자동 반영한다.
- 사용자 확정: Phase 1 실험실과 Phase 2 할 일 목록은 별도 페이지로 분리하고 서로 이동할 수 있는 링크를 제공한다. 기존 VDOM 표현과 엔진을 공유하는 세부 확장 방식은 제안이다.

사용자 선택 기록: [할 일 목록 선택](decisions/2026-11-10-phase2-demo.md), [페이지 분리](decisions/2026-11-10-phase2-pages.md), [JSX 사용](decisions/2026-11-10-phase2-jsx.md), [브라우저 저장](decisions/2026-11-10-phase2-storage.md), [컴포넌트 분할](decisions/2026-11-10-phase2-components.md), [Effect 시연](decisions/2026-11-10-phase2-effects.md), [앱 생명주기 시연](decisions/2026-11-10-phase2-lifecycle-demo.md), [학습 패널](decisions/2026-11-10-phase2-learning-panel.md), [상태 갱신 묶음 처리](decisions/2026-11-10-phase2-batching.md).

## 페이지와 컴포넌트

사용자 확정: 역할별로 5종의 자식 컴포넌트를 둔다. TodoItem은 TodoList 내부에서 반복 사용한다. 아래 함수 이름과 세부 props 이름은 구현 제안이다.

```text
App — 유일한 FunctionComponent 인스턴스, 모든 Hook과 State 소유
├── TodoForm({ draft, onDraftChange, onAdd })
├── TodoFilters({ filter, onFilterChange })
├── TodoList({ visibleTodos, onToggle, onDelete })
│   └── TodoItem({ todo, onToggle, onDelete }) × N
└── TodoSummary({ totalCount, completedCount })
```

자식 함수는 호출할 때마다 VDOM을 반환한다. 별도의 hooks 배열이나 인스턴스를 만들지 않는다. 자식은 props를 수정하지 않으며 DOM 조작·저장소 접근을 렌더링 중 실행하지 않는다. 전달받은 콜백은 이벤트가 발생했을 때만 호출한다.

### App의 데이터

| 종류 | 데이터 | 사용 목적 |
| --- | --- | --- |
| useState | `todos: [{ id, text, completed }]` | 추가·완료 전환·삭제 |
| useState | `draft: string` | 현재 입력창 값 |
| useState | `filter: all / active / completed` | 전체·미완료·완료 표시 |
| useMemo | `visibleTodos`, 의존성 `[todos, filter]` | 필터된 목록 재사용 |
| useMemo | `completedCount`, 의존성 `[todos]` | 완료 개수 계산 결과 재사용 |
| useEffect | 목록 저장, 의존성 `[todos]` | DOM 반영 후 할 일 목록과 완료 상태를 localStorage에 저장 |
| useEffect | 문서 제목 갱신, 의존성 `[completedCount, todos.length]` | 사용자가 저장과 함께 선택한 시연 동작. `할 일 2 / 5 완료` 형식으로 표시하고 해제 시 원래 제목 복원 |

작은 할 일 목록에서 useMemo는 성능 최적화가 필요해서가 아니라 과제의 계산 결과 재사용을 시연하기 위해 사용한다. todos는 배열·객체를 직접 변경하지 않고 새 값으로 교체한다. 항목 id는 추가 이벤트에서 한 번 만들며 렌더링 중 바꾸지 않는다. 빈 입력은 추가하지 않는다. 사용자가 새로고침 후 할 일과 완료 상태를 유지하도록 선택했다. localStorage를 사용하며, 같은 브라우저·같은 origin에서 유지되고 서버 동기화는 하지 않는다.

## 브라우저 저장

확정 범위는 할 일 목록과 각 항목의 완료 상태 유지다. 구현 방식은 다음과 같이 제안한다.

- App의 todos 초기 상태를 만들 때 localStorage를 읽는다. 최초 초기화에서만 읽도록 useState의 지연 초기화를 이용한다.
- todos가 바뀌면 useEffect에서 JSON으로 저장한다. 전체 Hook 배열이나 VDOM·이벤트 함수를 저장하지 않는다.
- JSON 파싱뿐 아니라 항목의 id·text·completed 자료형과 id 중복을 검증한다.
- 읽기·쓰기 실패를 사용자에게 알린다. 저장이 실패해도 현재 페이지의 편집 상태는 유지한다. 손상된 기존 데이터를 초기화로 조용히 덮어쓰지 않도록 실패 시 저장을 중단한다.
- 사용자 확정: todos의 목록·완료 상태만 저장한다. 입력 중인 draft는 빈 문자열, filter는 all로 초기화한다. 새로고침과 앱 재시작 모두 같은 정책을 적용한다.

## Effect 시연 확정 범위

- 사용자는 할 일 저장과 탭 제목 변경을 함께 시연하도록 선택했다.
- 저장 Effect는 todos에 의존한다. 제목 Effect는 완료 개수와 전체 개수에 의존한다.
- 제목 정리 함수에서 복원할 원래 제목은 mount 수명 전체에서 동일하게 유지하도록 보관한다. 정리 후 새 제목을 적용하고 unmount 시 원래 제목으로 복원한다.
- 사용자 확정: 앱 바깥의 페이지 제어 영역에 종료·다시 시작 버튼을 둔다. 종료 시 unmount하여 화면·리스너·Effect를 정리하고 원래 제목을 복원한다. 다시 시작은 새 FunctionComponent 인스턴스를 만들고 저장된 todos를 읽어 mount한다. 저장된 데이터는 종료로 삭제하지 않는다. 중복 mount·unmount를 막도록 현재 상태에 맞게 버튼을 비활성화하는 방식은 구현 제안이다.

## 학습 패널

사용자 확정: 접이식 학습 패널에서 렌더링 횟수와 useMemo 계산 횟수를 비교한다. 아래 계측 방식은 구현 제안이다.

- App의 렌더링 횟수와 목록 필터·완료 개수 각각의 Memo 계산 횟수를 구분한다.
- draft만 변경하면 렌더링은 증가하고 두 Memo 계산은 유지된다. filter 변경은 목록 Memo만, todos 변경은 두 Memo 모두 다시 계산하는 예제를 보여준다.
- 계측은 런타임에서 수행한다. 컴포넌트·Memo 계산 함수에 계측 부작용을 넣지 않는다. 화면의 횟수는 성공한 DOM 반영 이후 갱신하며, 계측 표시 때문에 별도 상태 변경·재렌더링을 발생시키지 않는다.
- 패널은 할 일 앱 외부의 시연 영역에 두고 접기·펼치기는 네이티브 details를 사용한다. 새로운 앱 인스턴스로 다시 시작하면 횟수도 초기화한다.
- 테스트에서 렌더 횟수 증가와 Memo 계산 횟수 유지·증가를 각각 검증한다.

## 전체 흐름

```text
첫 진입: new FunctionComponent(App, container).mount()
  → App 실행 → 자식 함수 실행 → VDOM → createDOM → DOM 삽입
  → 성공한 VDOM 보관 → 예약된 Effect 실행

사용자 이벤트 → props로 전달한 콜백 → setState
  → hooks 슬롯 값 변경 → update 예약
  → App 재실행 → 새 VDOM
  → diff(이전 VDOM, 새 VDOM) → patch(실제 루트 DOM, 변경 목록)
  → 반환된 루트 DOM과 새 VDOM 보관 → 필요한 Effect 정리·실행
```

수동 Patch 버튼은 Phase 2에 필요하지 않다. 같은 자리에 있는 입력창과 같은 key의 할 일 DOM은 기존 Diff·Patch로 유지한다.

## FunctionComponent 책임

한 인스턴스가 루트 하나를 관리한다.

| 필드 | 책임 |
| --- | --- |
| `component`, `props`, `container` | 실행할 루트 함수와 입력·삽입 위치 |
| `hooks` | State·Effect·Memo 슬롯을 호출 순서대로 보관 |
| `hookIndex` | 이번 렌더링에서 사용할 다음 슬롯 위치 |
| `previousVNode`, `rootDOM` | 마지막으로 성공한 VDOM과 실제 DOM 참조 |
| 렌더링·예약·해제 상태 | 중복 예약, 재진입, 해제 후 업데이트 방지 |

- `mount()`: 한 번만 초기 렌더링한다. 실제 DOM 삽입 후 Effect를 실행한다.
- `update()`: 새 VDOM을 생성하고 Diff·Patch 성공 후 기준 VDOM을 교체한다.
- `unmount()`: Effect 정리 함수 실행, 루트 DOM 제거, 이벤트 해제와 예약 업데이트 무효화. 사용자가 선택한 종료 시연 버튼에서 호출한다.
- 렌더링 직전에 `hookIndex = 0`으로 되돌린다. 현재 실행 중인 인스턴스는 렌더링 동안만 설정하고 `finally`에서 해제한다.
- 사용자 확정: 한 이벤트의 연속 상태 변경은 묶어서 최신 상태로 한 번 렌더링한다. 구현 제안: setState는 슬롯을 즉시 갱신하고 `queueMicrotask`로 update를 예약한다. 같은 인스턴스의 중복 예약은 하나로 합친다. 함수형 갱신은 최신 슬롯 값에 순서대로 적용한다. 예약 플래그는 콜백 실행 전에 해제하고, unmount된 인스턴스의 예약은 무효화한다. 모든 비동기 경계를 하나로 묶는 React 전체 자동 batching을 구현하는 범위는 아니다.
- 렌더링 중 상태 변경은 오류로 처리한다. Effect 안에서 상태를 변경하면 다음 업데이트로 예약하여 중첩 렌더링을 피한다.
- 렌더링·Diff·Patch 실패를 성공으로 기록하지 않는다. 실패한 렌더링의 Effect는 실행하지 않는다. 상태를 과거 값으로 자동 롤백하는 기능은 제공하지 않는다. Effect가 실패하면 DOM 반영 실패와 구분하여 알린다.

## JSX와 VDOM 생성 API

사용자 확정: 컴포넌트의 UI는 JSX로 작성한다. 아래 변환 방식과 내부 API는 구현 제안이다.

```jsx
function TodoForm({ draft, onDraftChange, onAdd }) {
  return (
    <div>
      <input value={draft} onInput={onDraftChange} />
      <button type="button" onClick={onAdd}>추가</button>
    </div>
  );
}

<TodoSummary totalCount={todos.length} completedCount={completedCount} />
```

- Vite의 JSX 변환 설정을 이용해 JSX를 자체 `h(type, props, ...children)` 호출로 변환한다. React 런타임을 사용하지 않는다. 별도 의존성 추가 필요 여부는 설정 확인 후 판단한다.
- 문자열 태그는 기존 `{ type, tag, key, attributes, properties, children }` 객체로 변환한다. `events`는 선택 필드로 추가한다.
- JSX props에서 key는 식별자, onClick·onInput 등은 events, 입력 요소의 value·checked는 properties로 분리한다. className은 class로 옮기고 일반 속성값은 DOM 속성에 맞게 정규화한다. 지원 props 범위와 검증은 구현 시 명시한다.
- 문자열·숫자 자식은 텍스트 VDOM으로 바꾸고, 배열은 펼친다. null·undefined·boolean 자식은 생략한다. 컴포넌트는 루트 VDOM 하나를 반환한다. Fragment는 초기 제안 범위에 포함하지 않는다.
- 함수 태그는 자식 컴포넌트를 props로 실행한다. 실행 중 Hook 사용을 금지하고 `finally`에서 이전 실행 문맥으로 복귀한다.
- 자식은 JSX의 `<Child />`로 호출하는 규칙을 사용한다. 일반 JavaScript 함수 직접 호출까지 자동 식별할 수는 없다.
- 할 일 key는 `<TodoItem key={todo.id} ... />`에서 전달한 식별자를 반환된 최상위 li에 적용하는 방식으로 제안한다. key는 일반 props와 분리한다.
- DOM 변환용 `domToVNode()`는 Phase 1의 데이터 변환 용도로 유지한다. Phase 2는 컴포넌트 반환 VDOM을 기준으로 하며, DOM을 다시 읽어서 이벤트 함수나 상태를 복원하지 않는다.

## 이벤트와 기존 엔진 연결

현재 엔진은 일반 속성과 폼 속성만 다룬다. 이벤트 함수를 문자열 속성으로 넣으면 동작하지 않으므로 이벤트는 별도로 처리한다.

```js
{
  type: 'element',
  tag: 'input',
  key: 'draft',
  attributes: { type: 'text' },
  properties: { value: draft },
  events: { input: onDraftChange },
  children: []
}
```

- `createDOM`: events의 함수들을 addEventListener로 연결한다.
- `diff`: 이벤트 이름과 함수 참조를 비교해 `SET_EVENT`, `REMOVE_EVENT`를 만든다. events가 없으면 빈 객체로 처리한다.
- `patch`: 기존 경로 해결·사전 검증을 공유하고 이벤트 설정·제거 작업을 지원한다.
- 작은 공통 이벤트 도우미가 WeakMap으로 DOM별 연결 함수를 보관한다. 교체할 때 이전 함수를 removeEventListener한 뒤 새 함수를 연결한다. 매 렌더링의 인라인 함수도 중복 등록과 오래된 상태 참조 없이 갱신한다.
- 삭제·교체·unmount로 떠나는 서브트리의 리스너도 제거한다. DOM에 보관용 HTML 속성을 추가하지 않는다.
- 이벤트 추가는 함수, 제거는 이벤트 이름을 검증한다. 이벤트 캡처 옵션과 사용자 정의 이벤트 시스템은 제공하지 않는다.
- Phase 1 히스토리에는 기존처럼 함수 없는 데이터만 저장한다. Phase 2의 함수 포함 VDOM을 JSON이나 structuredClone으로 보관하지 않는다.

## Hook 동작 규칙

모든 Hook은 하나의 hooks 배열에서 슬롯을 공유한다. 슬롯마다 종류를 보관하여 호출 개수·종류가 달라지면 오류를 낸다. 같은 종류끼리 조건에 따라 자리를 바꾸는 모든 경우까지 감지할 수는 없으므로 조건문·반복문에서 Hook을 호출하지 않는 규칙을 지킨다.

### useState(initialValue)

- 처음 슬롯을 사용할 때만 초기화한다. 함수 초기값이면 한 번 실행한다.
- `[현재 값, 안정된 setter]`를 반환한다. setter는 렌더링 후에도 해당 인스턴스와 슬롯 번호를 기억한다.
- setter는 값과 함수형 갱신 `setCount(previous => previous + 1)`을 받는다.
- `Object.is`로 같은 값이면 추가 업데이트를 예약하지 않는다. 이미 예약된 다른 변경을 취소하지는 않는다.
- 해제된 인스턴스의 setter는 업데이트를 발생시키지 않는다.

### useEffect(callback, deps?)

- 의존성을 생략하면 매 성공한 렌더링 후 실행한다.
- `[]`이면 mount 후 한 번 실행한다. 의존성이 있으면 길이와 각 값을 Object.is로 비교한다.
- 변경 시 이전 정리 함수를 먼저 실행하고 새 Effect를 실행한다. unmount에도 마지막 정리 함수를 실행한다.
- 렌더링 중에는 실행하지 않는다. DOM 반영 후 실행하며 브라우저가 화면을 그린 뒤라는 보장은 하지 않는다.
- Effect 콜백은 함수 또는 undefined를 반환한다. async Effect와 Promise 반환은 지원하지 않는다.

### useMemo(factory, deps?)

- 처음에는 factory를 실행해 결과를 보관한다.
- 의존성이 같으면 이전 결과를 반환하고, 바뀌면 다시 계산한다. 의존성을 생략하면 매 렌더링 계산한다.
- 결과가 undefined·0·false여도 캐시가 없는 것으로 오해하지 않도록 슬롯 존재로 초기화를 판단한다.
- factory는 계산만 수행하며 상태 변경이나 DOM 조작을 하지 않는다.

## 파일 구성 제안

| 파일 | 역할 |
| --- | --- |
| `src/component.js` | FunctionComponent와 렌더링 문맥, 업데이트 예약 |
| `src/hooks.js` | 세 Hook과 슬롯·의존성 비교 |
| `src/h.js` | JSX 변환 결과를 받아 VDOM 생성과 순수 자식 함수 실행 |
| `src/events.js` | DOM 리스너 설정·교체·제거 |
| `src/vdom.js`, `src/diff.js`, `src/patch.js` | 기존 엔진의 선택적 events 지원 |
| `phase2.html`, `src/phase2.jsx` | 할 일 앱과 mount 진입점 |

별도 페이지도 빌드 결과에 포함되도록 Vite 진입점을 설정한다. UI 프레임워크나 새 의존성은 추가하지 않는다. 파일 분할은 구현 시 실제 코드 크기에 맞춰 줄일 수 있다.

## 완료 기준과 구현 순서

1. **VDOM 생성·이벤트 연결**: h의 자식 정규화와 자식 Hook 금지를 검증한다. 이벤트 추가·교체·제거, 서브트리 정리, 같은 버튼 반복 클릭 시 리스너 중복·오래된 콜백이 없는지 확인한다.
2. **FunctionComponent·useState**: mount·update, 렌더 간 슬롯 보존, 여러 상태, 함수형 갱신, 동일 값 생략, 예약 합치기, 루트 변경, 잘못된 Hook 호출과 unmount 이후 setter를 검증한다.
3. **useEffect·useMemo**: 생략/빈/변경/동일 의존성, Object.is 비교, 정리 순서, unmount, false·undefined 캐시, 실패한 렌더링에서 Effect가 실행되지 않음을 검증한다.
4. **할 일 페이지**: 실제 Chrome에서 추가·빈 입력 차단·완료 전환·삭제·필터·완료 개수를 조작하고 새로고침 후 목록·완료 상태 복원과 저장 실패 처리를 확인한다. 문서 제목 갱신과 정리 함수의 원래 제목 복원을 검증한다. 같은 key 항목·입력 DOM 유지와 포커스·선택 범위, 반복 입력·클릭 시 최신 상태 반영을 확인한다.
5. **통합**: 기존 Phase 1 단위·브라우저 테스트를 유지하고 새 테스트를 추가한다. 두 페이지의 production build·직접 접근을 확인하고 README를 갱신한다.

이 문서는 전체 Phase 2 설계 초안이다. 사용자 요청으로 우선 지금까지 학습한 JSX → h() → VDOM → createDOM() 단계만 구현했다. FunctionComponent·이벤트·State·Hooks·할 일 앱은 아직 미구현이다. 현재 구현·검증 결과는 [Phase 2 진행](phase2-progress.md)을 참고한다.
