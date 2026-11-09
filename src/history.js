export class StateHistory {
  #entries;
  #cursor;

  constructor(initialTree, { entries = [initialTree], cursor = 0 } = {}) {
    this.#entries = [...entries];
    this.#cursor = cursor;
  }

  snapshot() { return { entries: [...this.#entries], cursor: this.#cursor }; }

  get current() { return this.#entries[this.#cursor]; }
  get position() { return this.#cursor; }
  get length() { return this.#entries.length; }
  get canBack() { return this.#cursor > 0; }
  get canForward() { return this.#cursor < this.#entries.length - 1; }

  push(tree) {
    this.#entries.splice(this.#cursor + 1, this.#entries.length, tree);
    this.#cursor += 1;
  }

  move(direction) {
    const next = this.#cursor + direction;
    if (next < 0 || next >= this.#entries.length) return null;
    this.#cursor = next;
    return this.current;
  }
}
