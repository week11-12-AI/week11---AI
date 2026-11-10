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
  }

  // 함수를 한 번 실행해서 VNode를 얻는다
  render() {
    currentComponent = this;
    this.hookIndex = 0;         // 매번 0번부터 다시 센다 → 같은 칸을 다시 쓴다
    try {
      return this.fn();
    } finally {
      currentComponent = null;
    }
  }

  // 처음 그리기: VNode → createDom → 화면
  mount() {
    this.vnode = this.render();
    this.container.replaceChildren(createDom(this.vnode));
  }

  // 다시 그리기: 새 VNode → diff(이전, 새) → applyPatches (바뀐 곳만)
  update() {
    const newVNode = this.render();
    const patches = diff(this.vnode, newVNode);
    applyPatches(this.container, patches);
    this.vnode = newVNode;
    this.lastPatches = patches; // 관찰용 (페이지·테스트에서 본다)
    return patches;
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
