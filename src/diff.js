/** Compare two Virtual DOM trees without touching either tree or the DOM. */
export function diff(previous, next) {
  if (!isVNode(previous) || !isVNode(next)) {
    throw new TypeError("diff expects two Virtual DOM nodes.");
  }

  validateKeys(previous);
  validateKeys(next);

  const changes = [];
  compareNodes(previous, next, [], changes);
  return changes;
}

function compareNodes(previous, next, path, changes) {
  if (previous.type !== next.type || hasDifferentIdentity(previous, next)) {
    changes.push({ type: "REPLACE", path, node: next });
    return;
  }

  if (previous.type === "text") {
    if (!Object.is(previous.value, next.value)) {
      changes.push({ type: "TEXT", path, value: next.value });
    }
    return;
  }

  if (previous.type !== "element") {
    changes.push({ type: "REPLACE", path, node: next });
    return;
  }

  compareRecord(previous.attributes, next.attributes, path, changes, {
    set: "SET_ATTRIBUTE",
    remove: "REMOVE_ATTRIBUTE",
  });
  compareRecord(previous.properties, next.properties, path, changes, {
    set: "SET_PROPERTY",
    remove: "REMOVE_PROPERTY",
  });
  compareChildren(previous.children ?? [], next.children ?? [], path, changes);
}

function compareChildren(previous, next, parentPath, changes) {
  const matches = matchChildren(previous, next);
  const replacements = findReplacements(previous, next, matches);
  const removedIndices = new Set();

  for (let oldIndex = previous.length - 1; oldIndex >= 0; oldIndex -= 1) {
    if (matches.oldToNew.has(oldIndex) || replacements.has(oldIndex)) continue;

    changes.push({
      type: "REMOVE",
      path: [...parentPath, oldIndex],
    });
    removedIndices.add(oldIndex);
  }

  const current = previous
    .map((node, oldIndex) => ({ node, oldIndex }))
    .filter(({ oldIndex }) => !removedIndices.has(oldIndex));

  for (let nextIndex = 0; nextIndex < next.length; nextIndex += 1) {
    const oldIndex = matches.newToOld.get(nextIndex);

    if (oldIndex !== undefined) {
      const currentIndex = current.findIndex(
        (entry) => entry.oldIndex === oldIndex,
      );

      if (currentIndex !== nextIndex) {
        changes.push({
          type: "MOVE",
          path: [...parentPath, oldIndex],
          parentPath,
          index: nextIndex,
        });

        const [entry] = current.splice(currentIndex, 1);
        current.splice(nextIndex, 0, entry);
      }

      continue;
    }

    const replacedOldIndex = replacements.get(nextIndex);
    if (replacedOldIndex !== undefined) {
      const currentIndex = current.findIndex(
        (entry) => entry.oldIndex === replacedOldIndex,
      );

      if (currentIndex !== nextIndex) {
        changes.push({
          type: "MOVE",
          path: [...parentPath, replacedOldIndex],
          parentPath,
          index: nextIndex,
        });

        const [entry] = current.splice(currentIndex, 1);
        current.splice(nextIndex, 0, entry);
      }

      changes.push({
        type: "REPLACE",
        path: [...parentPath, replacedOldIndex],
        node: next[nextIndex],
      });
      current[nextIndex] = { node: next[nextIndex], oldIndex: replacedOldIndex };
      continue;
    }

    changes.push({
      type: "ADD",
      path: parentPath,
      index: nextIndex,
      node: next[nextIndex],
    });
    current.splice(nextIndex, 0, { node: next[nextIndex], oldIndex: null });
  }

  for (let nextIndex = 0; nextIndex < next.length; nextIndex += 1) {
    const oldIndex = matches.newToOld.get(nextIndex);
    if (oldIndex !== undefined) {
      compareNodes(
        previous[oldIndex],
        next[nextIndex],
        [...parentPath, oldIndex],
        changes,
      );
      continue;
    }

  }
}

function matchChildren(previous, next) {
  const oldByKey = new Map();
  const oldUnkeyed = [];
  const newUnkeyed = [];
  const oldToNew = new Map();
  const newToOld = new Map();

  previous.forEach((node, oldIndex) => {
    if (hasKey(node)) oldByKey.set(node.key, oldIndex);
    else oldUnkeyed.push(oldIndex);
  });

  next.forEach((node, nextIndex) => {
    if (hasKey(node)) {
      const oldIndex = oldByKey.get(node.key);
      if (oldIndex !== undefined) addMatch(oldIndex, nextIndex, oldToNew, newToOld);
    } else {
      newUnkeyed.push(nextIndex);
    }
  });

  const unkeyedCount = Math.min(oldUnkeyed.length, newUnkeyed.length);
  for (let index = 0; index < unkeyedCount; index += 1) {
    addMatch(oldUnkeyed[index], newUnkeyed[index], oldToNew, newToOld);
  }

  return { oldToNew, newToOld };
}

function findReplacements(previous, next, matches) {
  const replacements = new Map();
  const replacementIndices = Math.min(previous.length, next.length);

  for (let index = 0; index < replacementIndices; index += 1) {
    if (matches.oldToNew.has(index) || matches.newToOld.has(index)) continue;

    if (previous[index].type !== next[index].type ||
        hasDifferentIdentity(previous[index], next[index])) {
      replacements.set(index, index);
    }
  }

  return replacements;
}

function addMatch(oldIndex, nextIndex, oldToNew, newToOld) {
  oldToNew.set(oldIndex, nextIndex);
  newToOld.set(nextIndex, oldIndex);
}

function validateKeys(node) {
  if (node.type !== "element") return;

  const seen = new Set();
  for (const child of node.children ?? []) {
    if (hasKey(child)) {
      if (seen.has(child.key)) {
        throw new Error(`Duplicate key among siblings: ${child.key}`);
      }
      seen.add(child.key);
    }
    validateKeys(child);
  }
}

function compareRecord(previous = {}, next = {}, path, changes, operationTypes) {
  for (const name of Object.keys(previous).sort()) {
    if (!(name in next)) {
      changes.push({ type: operationTypes.remove, path, name });
    }
  }

  for (const name of Object.keys(next).sort()) {
    if (!(name in previous) || !Object.is(previous[name], next[name])) {
      changes.push({
        type: operationTypes.set,
        path,
        name,
        value: next[name],
      });
    }
  }
}

function hasDifferentIdentity(previous, next) {
  if (previous.type === "element" && next.type === "element") {
    return previous.tag !== next.tag || previous.key !== next.key;
  }

  return false;
}

function hasKey(node) {
  return node.type === "element" && node.key != null;
}

function isVNode(node) {
  return node !== null && typeof node === "object" && typeof node.type === "string";
}
