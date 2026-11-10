import { describe, expect, it } from 'vitest';
import { diff } from '../src/diff.js';

const text = (value) => ({ type: 'text', value });
const element = (tag, children = [], key = null) => ({
  type: 'element',
  tag,
  key,
  attributes: {},
  children,
});

function applyListChanges(previous, changes) {
  const nodesByPath = new Map();
  const childrenByParentPath = new Map();

  function remember(node, path = []) {
    nodesByPath.set(JSON.stringify(path), node);
    if (node.type === 'element') {
      childrenByParentPath.set(JSON.stringify(path), [...node.children]);
      node.children.forEach((child, index) => remember(child, [...path, index]));
    }
  }

  remember(previous);

  const removals = changes
    .filter((change) => change.type === 'REMOVE')
    .sort((a, b) => comparePathsDescending(a.path, b.path));

  for (const change of removals) {
    const parentPath = JSON.stringify(change.path.slice(0, -1));
    const children = childrenByParentPath.get(parentPath);
    const oldNode = nodesByPath.get(JSON.stringify(change.path));
    const index = children.indexOf(oldNode);
    children.splice(index, 1);
  }

  for (const change of changes.filter((item) => ['ADD', 'MOVE'].includes(item.type))) {
    const parentPath = JSON.stringify(change.parentPath ?? change.path);
    const children = childrenByParentPath.get(parentPath);
    const node = change.type === 'ADD'
      ? change.node
      : nodesByPath.get(JSON.stringify(change.path));

    if (change.type === 'MOVE') {
      const oldParentPath = JSON.stringify(change.path.slice(0, -1));
      const oldChildren = childrenByParentPath.get(oldParentPath);
      const oldIndex = oldChildren.indexOf(node);
      oldChildren.splice(oldIndex, 1);
    }

    children.splice(change.index, 0, node);
  }

  return {
    children: childrenByParentPath.get('[]'),
  };
}

function comparePathsDescending(a, b) {
  if (a.length !== b.length) return b.length - a.length;
  for (let index = a.length - 1; index >= 0; index -= 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

function keyedItems(...keys) {
  return element('ul', keys.map((key) => element('li', [text(key)], key)));
}

function expectKeyedListReconciliation(previous, next) {
  const operations = diff(previous, next);
  const result = applyListChanges(previous, operations);

  expect(result.children.map((node) => node.key)).toEqual(
    next.children.map((node) => node.key),
  );
  return operations;
}

describe('keyed child reconciliation', () => {
  it('inserts in the middle without replacing the existing keyed nodes', () => {
    const previous = keyedItems('a', 'b');
    const oldNodes = [...previous.children];
    const previousSnapshot = structuredClone(previous);
    const next = keyedItems('a', 'x', 'b');

    const operations = diff(previous, next);
    expect(operations).toContainEqual(expect.objectContaining({ type: 'ADD', index: 1 }));
    const result = applyListChanges(previous, operations);
    expect(result.children.map((node) => node.key)).toEqual(['a', 'x', 'b']);
    expect(result.children[0]).toBe(oldNodes[0]);
    expect(result.children[2]).toBe(oldNodes[1]);
    expect(previous).toEqual(previousSnapshot);
    expect(previous.children[0]).toBe(oldNodes[0]);
    expect(previous.children[1]).toBe(oldNodes[1]);
  });

  it('removes a middle keyed node and retains the surrounding nodes', () => {
    const previous = keyedItems('a', 'b', 'c');
    const oldNodes = [...previous.children];
    const previousSnapshot = structuredClone(previous);
    const next = keyedItems('a', 'c');

    const operations = expectKeyedListReconciliation(previous, next);
    const result = applyListChanges(previous, operations);

    expect(operations).toContainEqual({ type: 'REMOVE', path: [1] });
    expect(result.children[0]).toBe(oldNodes[0]);
    expect(result.children[1]).toBe(oldNodes[2]);
    expect(previous).toEqual(previousSnapshot);
  });

  it('reorders swapped keyed siblings with a move and keeps their identities', () => {
    const previous = keyedItems('a', 'b');
    const oldNodes = [...previous.children];
    const previousSnapshot = structuredClone(previous);
    const next = keyedItems('b', 'a');

    const operations = expectKeyedListReconciliation(previous, next);
    const result = applyListChanges(previous, operations);

    expect(operations.some((change) => change.type === 'MOVE')).toBe(true);
    expect(result.children[0]).toBe(oldNodes[1]);
    expect(result.children[1]).toBe(oldNodes[0]);
    expect(previous).toEqual(previousSnapshot);
  });

  it('reconciles a more complex rotation with the target order', () => {
    const previous = keyedItems('a', 'b', 'c', 'd');
    const oldNodes = new Map(previous.children.map((node) => [node.key, node]));
    const previousSnapshot = structuredClone(previous);
    const next = keyedItems('c', 'a', 'd', 'b');

    const operations = expectKeyedListReconciliation(previous, next);
    const result = applyListChanges(previous, operations);

    expect(result.children.map((node) => node.key)).toEqual(['c', 'a', 'd', 'b']);
    for (const node of result.children) {
      expect(node).toBe(oldNodes.get(node.key));
    }
    expect(previous).toEqual(previousSnapshot);
  });

  it('uses the old path for a nested keyed node that moves and changes text', () => {
    const previous = element('main', [keyedItems('a', 'b')]);
    const next = element('main', [keyedItems('b', 'a')]);
    next.children[0].children[0].children[0].value = 'updated';

    const operations = diff(previous, next);

    expect(operations).toContainEqual({
      type: 'TEXT', path: [0, 1, 0], value: 'updated',
    });
    expect(operations.some((change) => change.type === 'MOVE')).toBe(true);
  });

  it('does not match an unkeyed text node against a keyed element', () => {
    const previous = element('div', [text('label'), element('span', [text('A')], 'a')]);
    const next = element('div', [element('span', [text('A')], 'a')]);

    const operations = diff(previous, next);

    expect(operations).toContainEqual({ type: 'REMOVE', path: [0] });
    expect(operations.some((change) => change.type === 'REPLACE' && change.path[0] === 0))
      .toBe(false);
  });

  it('matches unkeyed siblings in their own order around keyed nodes', () => {
    const previous = element('div', [
      element('i', [text('A')], 'a'),
      text('old label'),
      element('i', [text('B')], 'b'),
    ]);
    const next = element('div', [
      element('i', [text('B')], 'b'),
      text('new label'),
      element('i', [text('A')], 'a'),
    ]);

    const operations = diff(previous, next);

    expect(operations).toContainEqual({ type: 'TEXT', path: [1], value: 'new label' });
    expect(operations.some((change) => change.type === 'MOVE')).toBe(true);
  });

  it('allows the same key under different parents', () => {
    const previous = element('main', [keyedItems('shared'), element('aside', [element('b', [], 'shared')])]);
    const next = structuredClone(previous);

    expect(diff(previous, next)).toEqual([]);
  });

  it('rejects duplicate keys among old siblings', () => {
    const previous = keyedItems('duplicate', 'duplicate');
    const next = keyedItems('duplicate');

    expect(() => diff(previous, next)).toThrow(/duplicate key/i);
  });

  it('rejects duplicate keys among new siblings', () => {
    const previous = keyedItems('a');
    const next = keyedItems('duplicate', 'duplicate');

    expect(() => diff(previous, next)).toThrow(/duplicate key/i);
  });

  it('checks duplicate keys inside a newly added subtree', () => {
    const previous = element('main');
    const next = element('main', [keyedItems('duplicate', 'duplicate')]);

    expect(() => diff(previous, next)).toThrow(/duplicate key/i);
  });

  it('replaces a matching key when the element tag changes', () => {
    const previous = element('ul', [element('li', [text('a')], 'a')]);
    const replacement = element('h2', [text('a')], 'a');
    const next = element('ul', [replacement]);

    expect(diff(previous, next)).toContainEqual({
      type: 'REPLACE', path: [0], node: replacement,
    });
  });

  it('does not mutate either input tree while reconciling', () => {
    const previous = keyedItems('a', 'b', 'c');
    const next = keyedItems('c', 'x', 'a');
    const oldSnapshot = structuredClone(previous);
    const nextSnapshot = structuredClone(next);

    diff(previous, next);

    expect(previous).toEqual(oldSnapshot);
    expect(next).toEqual(nextSnapshot);
  });

  it('handles empty-to-populated and populated-to-empty children', () => {
    const empty = keyedItems();
    const filled = keyedItems('a', 'b');

    expectKeyedListReconciliation(empty, filled);
    expectKeyedListReconciliation(filled, empty);
  });
});
