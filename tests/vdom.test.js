// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createDOM, domToVNode } from '../src/vdom.js';

describe('DOM and Virtual DOM conversion', () => {
  it('preserves nested elements, attributes, keys, and text', () => {
    const source = document.createElement('section');
    source.innerHTML = '<h2 data-key="title" class="heading">Title</h2><p data-key="message" id="intro">Hello</p>';

    const vnode = domToVNode(source);
    const result = createDOM(vnode);

    expect(result.isEqualNode(source)).toBe(true);
    expect(vnode.children[0].key).toBe('title');
    expect(vnode.children[0].attributes.class).toBe('heading');
    expect(vnode.children[1].children[0].value).toBe('Hello');
  });

  it('preserves spaces and line breaks between child nodes', () => {
    const source = document.createElement('div');
    source.innerHTML = '<span>A</span> \n <span>B</span>';

    const result = createDOM(domToVNode(source));

    expect(result.innerHTML).toBe(source.innerHTML);
    expect(result.childNodes).toHaveLength(3);
    expect(result.childNodes[1].textContent).toBe(' \n ');
  });

  it('preserves a missing key as null and does not invent one', () => {
    const source = document.createElement('p');
    source.textContent = 'Plain paragraph';

    const vnode = domToVNode(source);
    const result = createDOM(vnode);

    expect(vnode.key).toBeNull();
    expect(result.hasAttribute('data-key')).toBe(false);
    expect(result.textContent).toBe('Plain paragraph');
  });

  it('round trips an input after its live value and checked state change', () => {
    const source = document.createElement('input');
    source.type = 'checkbox';
    source.value = 'initial';
    source.checked = false;
    source.value = 'edited';
    source.checked = true;

    const result = createDOM(domToVNode(source));

    expect(result.value).toBe('edited');
    expect(result.checked).toBe(true);
    expect(result.type).toBe('checkbox');
  });

  it('does not invent a value attribute for a default checkbox on round trip', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const vnode = domToVNode(checkbox);
    expect(domToVNode(createDOM(vnode))).toEqual(vnode);
    expect(createDOM(vnode).hasAttribute('value')).toBe(false);
  });

  it('rejects comment nodes with a clear error', () => {
    const comment = document.createComment('not rendered content');

    expect(() => domToVNode(comment)).toThrow();
  });
});
