import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';

const text = (value) => ({ type: 'text', value });
const element = (tag, children = [], options = {}) => ({
  type: 'element',
  tag,
  key: options.key ?? null,
  attributes: options.attributes ?? {},
  children,
  ...(options.properties ? { properties: options.properties } : {}),
});

describe('diff', () => {
  it('returns no operations when the trees have the same content', () => {
    const previous = element('div', [element('p', [text('Hello')])]);
    const next = element('div', [element('p', [text('Hello')])]);

    expect(diff(previous, next)).toEqual([]);
  });

  it('reports a text change at its path in the previous tree', () => {
    const previous = element('div', [element('p', [text('Hello')])]);
    const next = element('div', [element('p', [text('Goodbye')])]);

    expect(diff(previous, next)).toContainEqual({
      type: 'TEXT',
      path: [0, 0],
      value: 'Goodbye',
    });
  });

  it('reports an attribute value change without changing the input trees', () => {
    const previous = element('p', [], { attributes: { class: 'old' } });
    const next = element('p', [], { attributes: { class: 'new' } });
    const previousSnapshot = structuredClone(previous);
    const nextSnapshot = structuredClone(next);

    expect(diff(previous, next)).toContainEqual({
      type: 'SET_ATTRIBUTE',
      path: [],
      name: 'class',
      value: 'new',
    });
    expect(previous).toEqual(previousSnapshot);
    expect(next).toEqual(nextSnapshot);
  });

  it('reports an attribute removed from an element', () => {
    const previous = element('p', [], { attributes: { title: 'hint' } });
    const next = element('p');

    expect(diff(previous, next)).toContainEqual({
      type: 'REMOVE_ATTRIBUTE',
      path: [],
      name: 'title',
    });
  });

  it('reports an added child at its parent and target index', () => {
    const previous = element('ul', [element('li', [text('A')])]);
    const added = element('li', [text('B')], { key: 'b' });
    const next = element('ul', [element('li', [text('A')]), added]);

    expect(diff(previous, next)).toContainEqual({
      type: 'ADD',
      path: [],
      index: 1,
      node: added,
    });
  });

  it('reports removed children using paths in the previous tree', () => {
    const previous = element('ul', [
      element('li', [text('A')]),
      text('\n  '),
      element('li', [text('B')]),
    ]);
    const next = element('ul');

    const operations = diff(previous, next);

    expect(operations).toContainEqual({ type: 'REMOVE', path: [0] });
    expect(operations).toContainEqual({ type: 'REMOVE', path: [1] });
    expect(operations).toContainEqual({ type: 'REMOVE', path: [2] });
  });

  it('reports an element replacement at its previous path', () => {
    const previous = element('section', [element('p', [text('A')])]);
    const replacement = element('h2', [text('B')], { key: 'heading' });
    const next = element('section', [replacement]);

    expect(diff(previous, next)).toContainEqual({
      type: 'REPLACE',
      path: [0],
      node: replacement,
    });
  });

  it('supports replacing a text node with an element', () => {
    const previous = element('div', [text('A')]);
    const replacement = element('strong', [text('A')]);
    const next = element('div', [replacement]);

    expect(diff(previous, next)).toContainEqual({
      type: 'REPLACE',
      path: [0],
      node: replacement,
    });
  });

  it('reports changed live form properties', () => {
    const previous = element('input', [], { properties: { value: 'draft', checked: false } });
    const next = element('input', [], { properties: { value: 'saved', checked: true } });

    const operations = diff(previous, next);

    expect(operations).toContainEqual({
      type: 'SET_PROPERTY', path: [], name: 'value', value: 'saved',
    });
    expect(operations).toContainEqual({
      type: 'SET_PROPERTY', path: [], name: 'checked', value: true,
    });
  });

  it('does not confuse a child change with a parent attribute change', () => {
    const previous = element('main', [element('p', [text('A')])], {
      attributes: { id: 'content' },
    });
    const next = element('main', [element('p', [text('B')])], {
      attributes: { id: 'content' },
    });

    expect(diff(previous, next)).toEqual([
      { type: 'TEXT', path: [0, 0], value: 'B' },
    ]);
  });
});
