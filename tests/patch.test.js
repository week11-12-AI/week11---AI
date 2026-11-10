// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';
import { domToVNode } from '../src/vdom.js';
import { patch } from '../src/patch.js';

function makeRoot(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstChild;
}

function applyTarget(root, markup) {
  const previous = domToVNode(root);
  const next = domToVNode(makeRoot(markup));
  const changes = diff(previous, next);
  return { changes, root: patch(root, changes) };
}

describe('patch', () => {
  it('returns the same root and keeps element and text node identities when nothing changed', () => {
    const root = makeRoot('<div><p>Hello</p></div>');
    const paragraph = root.firstChild;
    const text = paragraph.firstChild;

    const result = patch(root, []);

    expect(result).toBe(root);
    expect(root.firstChild).toBe(paragraph);
    expect(paragraph.firstChild).toBe(text);
  });

  it('changes only the text node', () => {
    const root = makeRoot('<div><p>Hello</p><input value="draft"></div>');
    const paragraph = root.firstChild;
    const input = root.lastChild;

    const result = applyTarget(root, '<div><p>Goodbye</p><input value="draft"></div>');

    expect(result.root).toBe(root);
    expect(paragraph.textContent).toBe('Goodbye');
    expect(root.firstChild).toBe(paragraph);
    expect(root.lastChild).toBe(input);
  });

  it('sets and removes attributes without replacing the element', () => {
    const root = makeRoot('<p class="old" title="hint">Hello</p>');
    const original = root;

    applyTarget(root, '<p class="new">Hello</p>');

    expect(root).toBe(original);
    expect(root.getAttribute('class')).toBe('new');
    expect(root.hasAttribute('title')).toBe(false);
  });

  it('adds and removes a child at the requested position', () => {
    const root = makeRoot('<ul><li data-key="a">A</li><li data-key="b">B</li></ul>');
    const first = root.firstChild;
    const last = root.lastChild;

    applyTarget(root, '<ul><li data-key="a">A</li><li data-key="x">X</li><li data-key="b">B</li></ul>');

    expect(Array.from(root.children, (node) => node.textContent)).toEqual(['A', 'X', 'B']);
    expect(root.children[0]).toBe(first);
    expect(root.children[2]).toBe(last);

    applyTarget(root, '<ul><li data-key="b">B</li></ul>');

    expect(Array.from(root.children, (node) => node.textContent)).toEqual(['B']);
    expect(root.firstChild).toBe(last);
  });

  it('replaces an element when its tag changes', () => {
    const root = makeRoot('<section><p>Hello</p></section>');
    const oldParagraph = root.firstChild;

    applyTarget(root, '<section><h2>Hello</h2></section>');

    expect(root.firstChild.tagName).toBe('H2');
    expect(root.firstChild).not.toBe(oldParagraph);
  });

  it('returns a replacement when the root itself changes', () => {
    const root = makeRoot('<p>Hello</p>');

    const result = applyTarget(root, '<h2>Welcome</h2>');

    expect(result.root.tagName).toBe('H2');
    expect(result.root.textContent).toBe('Welcome');
    expect(root.isConnected).toBe(false);
  });

  it('moves a keyed input and preserves its live value, checked state, focus, and DOM identity', () => {
    const root = makeRoot('<div><input data-key="a"><input data-key="b"></div>');
    document.body.appendChild(root);
    const inputA = root.children[0];
    const inputB = root.children[1];
    const previous = domToVNode(root);
    const next = domToVNode(makeRoot('<div><input data-key="b"><input data-key="a"></div>'));
    const changes = diff(previous, next);
    inputB.value = 'unsaved draft';
    inputB.checked = true;
    inputB.focus();

    try {
      patch(root, changes);

      expect(root.children[0]).toBe(inputB);
      expect(root.children[1]).toBe(inputA);
      expect(inputB.value).toBe('unsaved draft');
      expect(inputB.checked).toBe(true);
      expect(document.activeElement).toBe(inputB);
    } finally {
      root.remove();
    }
  });

  it('preserves an input selection range while moving the input', () => {
    const root = makeRoot('<div><input data-key="a"><input data-key="b" value="draft"></div>');
    document.body.appendChild(root);
    const input = root.children[1];
    const next = domToVNode(makeRoot('<div><input data-key="b" value="draft"><input data-key="a"></div>'));
    const changes = diff(domToVNode(root), next);
    expect(changes).toContainEqual({ type: 'MOVE', path: [1], parentPath: [], index: 0 });
    input.focus();
    input.setSelectionRange(2, 5);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);

    try {
      patch(root, changes);

      expect(root.children[0]).toBe(input);
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(5);
      expect(document.activeElement).toBe(input);
    } finally {
      root.remove();
    }
  });

  it('handles moving a focused input from text to number without a selection API error', () => {
    const root = makeRoot('<div><input data-key="other"><input data-key="number" type="text" value="1234"></div>');
    document.body.appendChild(root);
    const input = root.children[1];
    const next = domToVNode(makeRoot('<div><input data-key="number" type="number" value="1234"><input data-key="other"></div>'));
    const changes = diff(domToVNode(root), next);
    expect(changes).toContainEqual({ type: 'MOVE', path: [1], parentPath: [], index: 0 });
    expect(changes).toContainEqual({ type: 'SET_ATTRIBUTE', path: [1], name: 'type', value: 'number' });
    input.focus();
    input.setSelectionRange(1, 3);

    try {
      expect(() => patch(root, changes)).not.toThrow();

      expect(root.children[0]).toBe(input);
      expect(input.type).toBe('number');
      expect(input.value).toBe('1234');
    } finally {
      root.remove();
    }
  });

  it('applies mixed keyed insertion, removal, and movement in final order', () => {
    const root = makeRoot('<ul><li data-key="a">A</li><li data-key="b">B</li><li data-key="c">C</li></ul>');
    const oldNodes = new Map(Array.from(root.children, (node) => [node.dataset.key, node]));

    applyTarget(root, '<ul><li data-key="x">X</li><li data-key="c">C</li><li data-key="a">A</li><li data-key="y">Y</li></ul>');

    expect(Array.from(root.children, (node) => node.dataset.key)).toEqual(['x', 'c', 'a', 'y']);
    expect(root.children[1]).toBe(oldNodes.get('c'));
    expect(root.children[2]).toBe(oldNodes.get('a'));
  });

  it('replaces a moved element when its tag changes but its key stays the same', () => {
    const root = makeRoot('<ul><li data-key="a">A</li><li data-key="b">B</li><li data-key="c">C</li></ul>');
    const originalA = root.children[0];
    const originalB = root.children[1];
    const originalC = root.children[2];

    applyTarget(root, '<ul><li data-key="b">B</li><p data-key="c">C</p><li data-key="a">A</li></ul>');

    expect(Array.from(root.children, (node) => node.dataset.key)).toEqual(['b', 'c', 'a']);
    expect(root.children[0]).toBe(originalB);
    expect(root.children[1].tagName).toBe('P');
    expect(root.children[1]).not.toBe(originalC);
    expect(root.children[2]).toBe(originalA);
  });

  it('handles multiple keyed inserts, removes, moves, and a nested text change together', () => {
    const root = makeRoot('<ul><li data-key="a"><span>Alpha</span></li><li data-key="b">B</li><li data-key="c">C</li><li data-key="d">D</li></ul>');
    const originalA = root.children[0];
    const originalD = root.children[3];

    applyTarget(root, '<ul><li data-key="x">X</li><li data-key="d">D</li><li data-key="a"><span>Updated alpha</span></li><li data-key="y">Y</li></ul>');

    expect(Array.from(root.children, (node) => node.dataset.key)).toEqual(['x', 'd', 'a', 'y']);
    expect(root.children[1]).toBe(originalD);
    expect(root.children[2]).toBe(originalA);
    expect(root.children[2].textContent).toBe('Updated alpha');
  });

  it('uses old paths for nested edits after a keyed parent moves', () => {
    const root = makeRoot('<main><section data-key="a"><p>Alpha</p></section><section data-key="b"><p>Beta</p></section></main>');
    const sectionA = root.children[0];
    const sectionB = root.children[1];

    applyTarget(root, '<main><section data-key="b"><p>Updated beta</p></section><section data-key="a"><p>Alpha</p></section></main>');

    expect(root.children[0]).toBe(sectionB);
    expect(root.children[0].textContent).toBe('Updated beta');
    expect(root.children[1]).toBe(sectionA);
  });

  it('keeps keyless text nodes in their own order while keyed nodes move', () => {
    const root = makeRoot('<div><i data-key="a">A</i>label<i data-key="b">B</i></div>');
    const keyedA = root.children[0];
    const text = root.childNodes[1];
    const keyedB = root.children[1];

    applyTarget(root, '<div><i data-key="b">B</i>updated<i data-key="a">A</i></div>');

    expect(root.children[0]).toBe(keyedB);
    expect(root.childNodes[1]).toBe(text);
    expect(text.textContent).toBe('updated');
    expect(root.children[1]).toBe(keyedA);
  });

  it('applies property changes to live form controls', () => {
    const root = makeRoot('<form><input data-key="entry" value="before"><input data-key="check" type="checkbox"></form>');
    const entry = root.children[0];
    const checkbox = root.children[1];
    entry.value = 'typed while editing';

    applyTarget(root, '<form><input data-key="entry" value="saved"><input data-key="check" type="checkbox" checked></form>');

    expect(root.children[0]).toBe(entry);
    expect(root.children[1]).toBe(checkbox);
    expect(entry.value).toBe('saved');
    expect(checkbox.checked).toBe(true);
  });

  it('keeps multiple selected options when a select receives an added and replaced option', () => {
    const root = makeRoot('<select multiple><option data-key="a" value="a" selected>A</option><option data-key="b" value="b">B</option></select>');

    applyTarget(root, '<select multiple><option data-key="a" value="a" selected>A</option><option data-key="c" value="c" selected>C</option><option data-key="d" value="d" selected>D</option></select>');

    expect(Array.from(root.selectedOptions, (option) => option.value)).toEqual(['a', 'c', 'd']);
  });

  it('keeps all initially selected options when a multiple select is added', () => {
    const root = makeRoot('<div></div>');

    applyTarget(root, '<div><select multiple><option value="a" selected>A</option><option value="b" selected>B</option></select></div>');

    const select = root.firstChild;
    expect(Array.from(select.selectedOptions, (option) => option.value)).toEqual(['a', 'b']);
  });

  it('keeps all initially selected options when a root is replaced by a multiple select', () => {
    const root = makeRoot('<p>Before</p>');
    const next = domToVNode(makeRoot('<select multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>'));
    const replacement = patch(root, diff(domToVNode(root), next));

    expect(replacement.tagName).toBe('SELECT');
    expect(Array.from(replacement.selectedOptions, (option) => option.value)).toEqual(['a', 'b']);
  });

  it('changes a file input to text without trying to write a file path', () => {
    const root = makeRoot('<form><input data-key="upload" type="file"></form>');
    const input = root.firstChild;

    applyTarget(root, '<form><input data-key="upload" type="text"></form>');

    expect(root.firstChild).toBe(input);
    expect(input.type).toBe('text');
    expect(input.value).toBe('');
  });

  it('clears a text input before changing it to file', () => {
    const root = makeRoot('<form><input data-key="upload" type="text" value="draft.txt"></form>');
    const input = root.firstChild;

    applyTarget(root, '<form><input data-key="upload" type="file"></form>');

    expect(root.firstChild).toBe(input);
    expect(input.type).toBe('file');
    expect(input.value).toBe('');
  });

  it('rejects duplicate keys before mutating the DOM', () => {
    const root = makeRoot('<ul><li data-key="a">A</li><li data-key="b">B</li></ul>');
    const before = root.cloneNode(true);
    const next = domToVNode(makeRoot('<ul><li data-key="x">X</li><li data-key="x">duplicate</li></ul>'));

    expect(() => diff(domToVNode(root), next)).toThrow(/duplicate key/i);
    expect(root.isEqualNode(before)).toBe(true);
  });

  it('rejects a malformed path before applying any valid change', () => {
    const root = makeRoot('<div><p>Original</p></div>');

    expect(() => patch(root, [
      { type: 'TEXT', path: [0, 0], value: 'Changed' },
      { type: 'REMOVE', path: [8] },
    ])).toThrow();
    expect(root.textContent).toBe('Original');
  });

  it('rejects an unknown operation before changing the DOM', () => {
    const root = makeRoot('<p>Original</p>');

    expect(() => patch(root, [
      { type: 'TEXT', path: [], value: 'Changed' },
      { type: 'UNKNOWN', path: [] },
    ])).toThrow();
    expect(root.textContent).toBe('Original');
  });
});
