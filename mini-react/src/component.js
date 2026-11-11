// mini-react Phase 2 — 함수형 컴포넌트 + Hooks
// Phase 1 블록(createDom, diff, applyPatches)을 그대로 다시 쓴다.

// ─────────────────────────────────────────────
// h(type, props, ...children) → VNode
//   코드에서 VNode를 짧게 적는 도우미 (JSX 대신).
//   VNode 약속을 지킨다: 숫자 글자 → 문자열 / null·false 자식은 버림 / 목록 자식은 펼침
// ─────────────────────────────────────────────
function h(type, props, ...children) {
  const kids = [];
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    kids.push(typeof child === "object" ? child : String(child));
  }
  return { type, props: props || {}, children: kids };
}

// 지금 그리는 중인 상자. useState가 "내 칸이 어느 상자에 있나"를 여기서 안다.
let currentComponent = null;

// ─────────────────────────────────────────────
// FunctionComponent   ⭐ 핵심
//   컴포넌트 함수는 부를 때마다 새로 실행되고 끝나면 지역 변수가 사라진다 (스택 프레임).
//   그래서 오래 살아 있는 이 상자가 대신 기억한다: hooks 배열 = 상태 칸.
// ─────────────────────────────────────────────
class FunctionComponent {
  constructor(fn, container) {
    this.fn = fn;               // 감싼 컴포넌트 함수
    this.container = container; // 화면 영역 (실제 DOM)
    this.hooks = [];            // 상태 칸. 부른 순서 = 칸 번호
    this.hookIndex = 0;         // 이번 그리기에서 몇 번째 hook인지
    this.vnode = null;          // 마지막으로 그린 VNode (diff의 "이전")
    this.effects = [];          // 다 그린 뒤 실행할 일 목록 (useEffect가 메모해 둔 것)
  }

  // 함수를 한 번 실행해서 VNode를 얻는다 (= 설계도 만들기. 브라우저 렌더링과 다름)
  render() {
    currentComponent = this;
    this.hookIndex = 0;         // 매번 0번부터 다시 센다 → 같은 칸을 다시 쓴다
    this.effects = [];          // 이번 그리기의 할 일 메모를 비운다
    try {
      return this.fn();
    } finally {
      currentComponent = null;
    }
  }

  // 처음 그리기: VNode → createDom → 화면 → 할 일 실행
  mount() {
    this.vnode = this.render();
    this.container.replaceChildren(createDom(this.vnode));
    this.runEffects();          // DOM을 다 고친 뒤에
  }

  // 다시 그리기: 새 VNode → diff(이전, 새) → applyPatches (바뀐 곳만) → 할 일 실행
  update() {
    const newVNode = this.render();
    const patches = diff(this.vnode, newVNode);
    applyPatches(this.container, patches);
    this.vnode = newVNode;
    this.lastPatches = patches; // 관찰용 (페이지·테스트에서 본다)
    this.runEffects();          // DOM을 다 고친 뒤에
    return patches;
  }

  // useEffect가 메모해 둔 일을 순서대로 실행하고 비운다
  runEffects() {
    const todo = this.effects;
    this.effects = [];
    for (const effect of todo) effect();
  }
}

// ─────────────────────────────────────────────
// useState(초기값) → [지금 값, 바꾸는 함수]   ⭐ 핵심
//   처음: 칸이 비어 있으면 초기값을 넣는다
//   다시: 칸에 저장된 값을 돌려준다 (초기값은 무시)
//   setState = 칸의 값을 바꾸고 + 다시 그리기(update)
// ─────────────────────────────────────────────
function useState(initial) {
  const comp = currentComponent;
  if (!comp) throw new Error("useState는 컴포넌트 함수 안에서만 부를 수 있다");

  const i = comp.hookIndex; // 이번이 몇 번째 hook인가 = 내 칸 번호
  comp.hookIndex++;

  if (i >= comp.hooks.length) {
    comp.hooks[i] = initial; // 처음: 칸이 없으니 초기값으로 만든다
  }

  const setState = (next) => {
    comp.hooks[i] = next; // 칸 바꾸기
    comp.update();        // 다시 그리기
  };

  return [comp.hooks[i], setState];
}

// ─────────────────────────────────────────────
// useEffect(할 일, 감시 목록)   ⭐ 핵심
//   할 일은 바로 실행하지 않고 메모만 한다 → DOM을 다 고친 뒤(runEffects) 실행
//   칸에는 "지난번 감시 목록"을 저장해 두고, 이번 목록과 비교한다
//     - 처음(칸이 비어 있음)      → 실행
//     - 감시 목록을 안 줬으면     → 매번 실행
//     - 하나라도 값이 달라졌으면  → 실행
//     - 전부 같으면              → 건너뜀
// ─────────────────────────────────────────────
function useEffect(effect, deps) {
  const comp = currentComponent;
  if (!comp) throw new Error("useEffect는 컴포넌트 함수 안에서만 부를 수 있다");

  const i = comp.hookIndex; // useState와 같은 번호표를 같이 쓴다
  comp.hookIndex++;

  const prevDeps = comp.hooks[i]; // 지난번 감시 목록 (처음엔 undefined)
  const changed =
    prevDeps === undefined ||
    deps === undefined ||
    deps.some((value, k) => value !== prevDeps[k]);

  if (changed) {
    comp.hooks[i] = deps;      // 이번 감시 목록을 칸에 저장 (다음 비교용)
    comp.effects.push(effect); // 할 일 메모
  }
}

// ─────────────────────────────────────────────
// useMemo(계산 함수, 감시 목록) → 계산 결과   ⭐ 핵심
//   무거운 계산 결과를 칸에 메모해 두고, 감시 값이 그대로면 다시 계산하지 않는다
//   감시 규칙은 useEffect와 같다. 다른 점: 다 그린 뒤가 아니라 "지금 바로" 계산해서 값을 돌려준다
//   칸에는 { 값, 감시 목록 } 을 저장한다
// ─────────────────────────────────────────────
function useMemo(compute, deps) {
  const comp = currentComponent;
  if (!comp) throw new Error("useMemo는 컴포넌트 함수 안에서만 부를 수 있다");

  const i = comp.hookIndex; // 같은 번호표를 같이 쓴다
  comp.hookIndex++;

  const prev = comp.hooks[i]; // { value, deps } 또는 처음엔 undefined
  const changed =
    prev === undefined ||
    deps === undefined ||
    deps.some((value, k) => value !== prev.deps[k]);

  if (changed) {
    comp.hooks[i] = { value: compute(), deps }; // 다시 계산해서 메모
  }
  return comp.hooks[i].value; // 메모해 둔 값을 돌려준다
}
