import { diff, element, patch, text, toDOM } from "./vdom.js";

let activeFrame = null;

export function h(type, props = {}, ...children) {
  if (typeof type !== "function") return element(type, props, ...children);

  // Children are pure functions. Only the FunctionComponent root may use hooks.
  const parentFrame = activeFrame;
  activeFrame = null;
  try {
    return type({ ...props, children });
  } finally {
    activeFrame = parentFrame;
  }
}

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

export function useMemo(compute, deps) {
  const { frame, index, previous } = claim("memo");
  const dependencies = copyDependencies(deps);
  const slot = previous && sameDependencies(previous.deps, dependencies)
    ? previous : { kind: "memo", deps: dependencies, value: compute() };
  frame.hooks[index] = slot;
  return slot.value;
}

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
      // An effect may request another update. Finish the current commit first.
      for (let passes = 0; this.pending && this.mounted; passes += 1) {
        if (passes === 50) throw new Error("Too many consecutive root updates.");
        this.pending = false;
        this.#renderAndCommit();
      }
    } finally {
      this.updating = false;
    }
  }

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
