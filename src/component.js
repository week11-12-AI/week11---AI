import { diff, element, patch, text, toDOM } from "./vdom.js";

let activeFrame = null;

export function h(type, props = {}, ...children) {
  if (typeof type !== "function") return element(type, props, ...children);

  // 자식 컴포넌트는 순수 함수로 호출하고, Hook은 루트 컴포넌트에서만 사용한다.
  const parentFrame = activeFrame;
  activeFrame = null;
  try {
    return type({ ...props, children });
  } finally {
    activeFrame = parentFrame;
  }
}

// Hook 호출 순서를 배열 위치로 사용해 이전 렌더링의 상태를 찾는다.
function claim(kind) {
  if (!activeFrame) throw new Error("Hooks are only available in the root component.");
  const index = activeFrame.cursor++;
  const previous = activeFrame.owner.hooks[index];
  if (previous && previous.kind !== kind) throw new Error("Hook order changed between renders.");
  return { frame: activeFrame, index, previous };
}

function sameDependencies(previous, next) {
  return previous !== undefined && next !== undefined && previous.length === next.length
    && previous.every((value, index) => Object.is(value, next[index]));
}

function copyDependencies(deps) {
  if (deps === undefined) return undefined;
  if (!Array.isArray(deps)) throw new TypeError("Dependencies must be an array.");
  return [...deps];
}

// 상태를 hooks 배열에 보관하고, 값이 달라지면 루트 컴포넌트를 다시 렌더링한다.
export function useState(initial) {
  const { frame, index, previous } = claim("state");
  const owner = frame.owner;
  let slot = previous;
  if (!slot) {
    slot = { kind: "state", value: typeof initial === "function" ? initial() : initial };
    slot.set = next => {
      if (owner.rendering) throw new Error("Call state setters outside render.");
      if (!owner.mounted || owner.hooks[index] !== slot) return;
      const value = typeof next === "function" ? next(slot.value) : next;
      if (Object.is(slot.value, value)) return;
      slot.value = value;
      owner.update();
    };
  }
  frame.hooks[index] = slot;
  return [slot.value, slot.set];
}

// 의존성이 같으면 이전 계산 결과를 재사용하고, 달라졌을 때만 다시 계산한다.
export function useMemo(compute, deps) {
  const { frame, index, previous } = claim("memo");
  const dependencies = copyDependencies(deps);
  const slot = previous && sameDependencies(previous.deps, dependencies)
    ? previous : { kind: "memo", deps: dependencies, value: compute() };
  frame.hooks[index] = slot;
  return slot.value;
}

// 의존성이 달라지면 DOM 반영 뒤 이전 작업을 정리하고 새 부수 효과를 실행한다.
export function useEffect(setup, deps) {
  const { frame, index, previous } = claim("effect");
  const dependencies = copyDependencies(deps);
  if (previous && sameDependencies(previous.deps, dependencies)) {
    frame.hooks[index] = previous;
    return;
  }

  const slot = { kind: "effect", deps: dependencies, cleanup: undefined };
  frame.hooks[index] = slot;
  frame.effects.push(() => {
    previous?.cleanup?.();
    const cleanup = setup();
    if (typeof cleanup === "function") slot.cleanup = cleanup;
  });
}

export class FunctionComponent {
  constructor(component, container, props = {}) {
    this.component = component;
    this.container = container;
    this.props = props;
    this.hooks = [];
    this.tree = null;
    this.root = null;
    this.mounted = false;
    this.rendering = false;
    this.updating = false;
    this.pending = false;
    this.lastPatchCount = 0;
  }

  mount() {
    if (this.mounted) throw new Error("Root is already mounted.");
    this.mounted = true;
    try {
      this.update();
    } catch (error) {
      if (!this.root) this.mounted = false;
      throw error;
    }
    return this.root;
  }

  update() {
    if (!this.mounted) return;
    this.pending = true;
    if (this.updating) return;

    this.updating = true;
    try {
      // Effect가 다시 렌더링을 요청해도 현재 변경을 화면에 반영한 뒤 처리한다.
      for (let passes = 0; this.pending && this.mounted; passes += 1) {
        if (passes === 50) throw new Error("Too many consecutive root updates.");
        this.pending = false;
        this.#renderAndCommit();
      }
    } finally {
      this.updating = false;
    }
  }

  // 함수가 반환한 VDOM을 이전 트리와 비교해 변경 부분을 Patch한 뒤 Effect를 실행한다.
  #renderAndCommit() {
    const frame = { owner: this, cursor: 0, hooks: [], effects: [] };
    const previousFrame = activeFrame;
    activeFrame = frame;
    this.rendering = true;
    let output;
    try {
      output = this.component(this.props);
      if (this.tree && frame.cursor !== this.hooks.length) {
        throw new Error("Hook count changed between renders.");
      }
    } finally {
      activeFrame = previousFrame;
      this.rendering = false;
    }

    const tree = output != null && typeof output === "object" ? output : text(output ?? "");
    if (this.tree) {
      const patches = diff(this.tree, tree);
      this.root = patch(this.root, patches);
      this.lastPatchCount = patches.length;
    } else {
      this.root = toDOM(tree, this.container.ownerDocument);
      this.container.replaceChildren(this.root);
      this.lastPatchCount = 1;
    }
    this.tree = tree;
    this.hooks = frame.hooks;
    for (const runEffect of frame.effects) runEffect();
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    try {
      for (const slot of this.hooks) if (slot.kind === "effect") slot.cleanup?.();
    } finally {
      this.hooks = [];
      this.root.remove();
      this.root = null;
      this.tree = null;
    }
  }
}
