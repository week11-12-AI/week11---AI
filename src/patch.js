import { createDOM } from "./vdom.js";

const operationTypes = new Set([
  "TEXT", "REPLACE", "REMOVE", "ADD", "MOVE",
  "SET_ATTRIBUTE", "REMOVE_ATTRIBUTE", "SET_PROPERTY", "REMOVE_PROPERTY",
]);
const liveProperties = {
  input: ["value", "checked"],
  textarea: ["value"],
  select: ["value"],
  option: ["selected"],
};

/** Apply changes whose paths refer to the original DOM tree. */
export function patch(root, changes) {
  if (!root || !Array.isArray(changes)) {
    throw new TypeError("patch expects a DOM root and an operation list.");
  }
  if (changes.length === 0) return root;

  const document = root.ownerDocument ?? root;
  const nodes = new Map();
  const prepared = changes.map((change) => prepare(change, root, nodes, document));
  const finalInputTypes = getFinalInputTypes(prepared);
  for (const operation of prepared) {
    if (operation.type === "SET_PROPERTY" || operation.type === "REMOVE_PROPERTY") {
      validateProperty(
        operation.target,
        operation.name,
        operation.value,
        finalInputTypes.get(operation.target),
      );
    }
  }
  validateStructure(prepared);
  const focus = captureFocus(
    root.ownerDocument?.activeElement,
    prepared,
    finalInputTypes,
  );

  for (const operation of prepared) {
    const { type, target } = operation;
    switch (type) {
      case "TEXT":
        if (target.nodeValue !== operation.value) target.nodeValue = operation.value;
        break;
      case "SET_ATTRIBUTE":
        if (target.getAttribute(operation.name) !== operation.value) {
          target.setAttribute(operation.name, operation.value);
        }
        break;
      case "REMOVE_ATTRIBUTE": target.removeAttribute(operation.name); break;
      case "SET_PROPERTY": setProperty(target, operation.name, operation.value); break;
      case "REMOVE_PROPERTY": resetProperty(target, operation.name); break;
      case "REMOVE": target.remove(); break;
      case "REPLACE":
        operation.result = createDOM(operation.node, document);
        target.parentNode?.replaceChild(operation.result, target);
        break;
      case "ADD":
        operation.result = createDOM(operation.node, document);
        insertAt(operation.parent, operation.index, operation.result);
        break;
      case "MOVE":
        operation.parent.removeChild(target);
        insertAt(operation.parent, operation.index, target);
        break;
      default: throw new TypeError(`Unsupported patch operation: ${type}`);
    }
  }

  const replacement = prepared.find(
    (operation) => operation.type === "REPLACE" && operation.path.length === 0,
  );
  if (focus) restoreFocus(focus);
  return replacement ? replacement.result : root;
}

function prepare(change, root, nodes, document) {
  if (!change || !operationTypes.has(change.type)) {
    throw new TypeError(`Unsupported patch operation: ${change?.type}`);
  }

  if (change.type === "ADD") {
    const parent = resolve(root, change.path, nodes);
    validateParent(parent);
    validateVNode(change.node, document);
    return { ...change, parent };
  }
  if (change.type === "MOVE") {
    const target = resolve(root, change.path, nodes);
    const parent = resolve(root, change.parentPath, nodes);
    validateParent(parent);
    if (target.parentNode !== parent) throw new TypeError("MOVE must keep its original parent.");
    return { ...change, target, parent };
  }

  const target = resolve(root, change.path, nodes);
  switch (change.type) {
    case "TEXT":
      if (target.nodeType !== target.TEXT_NODE || typeof change.value !== "string") {
        throw new TypeError("TEXT requires a text node and string value.");
      }
      break;
    case "SET_ATTRIBUTE":
      validateAttribute(target, change.name, document);
      if (typeof change.value !== "string") throw new TypeError("Attribute values must be strings.");
      break;
    case "REMOVE_ATTRIBUTE": validateAttribute(target, change.name, document); break;
    case "SET_PROPERTY":
      break;
    case "REMOVE_PROPERTY": break;
    case "REPLACE":
      if (target === document) throw new TypeError("Cannot replace the document node.");
      validateVNode(change.node, document);
      break;
    case "REMOVE":
      if (target === document) throw new TypeError("Cannot remove the document node.");
      break;
  }
  return { ...change, target };
}

function resolve(root, path, cache) {
  if (!Array.isArray(path) || path.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new TypeError("Paths must contain non-negative child indexes.");
  }
  const key = JSON.stringify(path);
  if (cache.has(key)) return cache.get(key);
  let node = root;
  for (const index of path) {
    if (!node.childNodes || index >= node.childNodes.length) {
      throw new RangeError(`DOM path does not exist: ${key}`);
    }
    node = node.childNodes[index];
  }
  cache.set(key, node);
  return node;
}

function validateStructure(operations) {
  const childLists = new Map();
  for (const operation of operations) {
    if (operation.type === "ADD" || operation.type === "MOVE") {
      if (!childLists.has(operation.parent)) {
        childLists.set(operation.parent, [...operation.parent.childNodes]);
      }
    }
  }

  for (const operation of operations) {
    if (operation.type === "REMOVE") {
      const children = childLists.get(operation.target.parentNode);
      if (children) removeReference(children, operation.target);
    } else if (operation.type === "MOVE") {
      const children = childLists.get(operation.parent);
      removeReference(children, operation.target);
      checkIndex(operation.index, children.length);
      children.splice(operation.index, 0, operation.target);
    } else if (operation.type === "ADD") {
      const children = childLists.get(operation.parent);
      checkIndex(operation.index, children.length);
      children.splice(operation.index, 0, operation.node);
    } else if (operation.type === "REPLACE") {
      const children = childLists.get(operation.target.parentNode);
      if (children) {
        const index = children.indexOf(operation.target);
        if (index !== -1) children[index] = operation.node;
      }
    }
  }
}

function removeReference(children, node) {
  const index = children.indexOf(node);
  if (index === -1) throw new RangeError("A patch operation targets a node more than once.");
  children.splice(index, 1);
}

function checkIndex(index, length) {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new RangeError(`Invalid child index: ${index}`);
  }
}

function validateParent(parent) {
  if (!parent.childNodes || typeof parent.insertBefore !== "function") {
    throw new TypeError("ADD and MOVE require a parent DOM node.");
  }
}

function validateVNode(vnode, document) {
  if (!vnode || typeof vnode !== "object") throw new TypeError("Invalid Virtual DOM node.");
  createDOM(vnode, document);
}

function validateAttribute(element, name, document) {
  if (element.nodeType !== element.ELEMENT_NODE || typeof name !== "string" || name === "data-key") {
    throw new TypeError("Attribute operations require an element and a valid attribute name.");
  }
  document.createAttribute(name);
}

function validateProperty(element, name, value, finalInputType = element.type) {
  if (element.nodeType !== element.ELEMENT_NODE || !liveProperties[element.localName]?.includes(name)) {
    throw new TypeError(`Unsupported live property ${name}.`);
  }
  if (name === "value" && element.localName === "input" && finalInputType === "file" && value !== undefined && value !== "") {
    throw new TypeError("A file input value cannot be patched.");
  }
  if (name === "value" && value !== undefined && typeof value !== "string") {
    throw new TypeError("value must be a string.");
  }
  if (name !== "value" && value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
}

function setProperty(element, name, value) {
  if (element[name] !== value) element[name] = value;
}

function resetProperty(element, name) {
  if (name === "value" && element.localName === "input" && element.type === "file") {
    element.value = "";
    return;
  }
  if (name === "value" && element.localName === "select") {
    for (const option of element.options) option.selected = option.defaultSelected;
    return;
  }
  const defaultProperty = {
    value: "defaultValue",
    checked: "defaultChecked",
    selected: "defaultSelected",
  }[name];
  setProperty(element, name, element[defaultProperty]);
}

function insertAt(parent, index, node) {
  const reference = parent.childNodes[index] ?? null;
  parent.insertBefore(node, reference);
}

function captureFocus(active, operations, finalInputTypes) {
  if (!active || !operations.some((operation) =>
    operation.type === "MOVE" &&
    (operation.target === active || operation.target.contains?.(active)))) {
    return null;
  }

  const inputType = finalInputTypes.get(active) ?? active.type;
  const state = { active, inputType };
  try {
    if (supportsSelectionRange(active, inputType) && typeof active.selectionStart === "number") {
      state.selectionStart = active.selectionStart;
      state.selectionEnd = active.selectionEnd;
      state.selectionDirection = active.selectionDirection;
    }
  } catch {
    // Some input types do not expose a text selection.
  }
  return state;
}

function restoreFocus(state) {
  if (!state.active.isConnected) return;
  state.active.focus({ preventScroll: true });
  if (state.selectionStart !== undefined && supportsSelectionRange(state.active, state.inputType)) {
    try {
      state.active.setSelectionRange(
        state.selectionStart,
        state.selectionEnd,
        state.selectionDirection,
      );
    } catch {
      // The browser may reject a selection after an input type changes.
    }
  }
}

function getFinalInputTypes(operations) {
  const finalTypes = new Map();
  for (const operation of operations) {
    if (operation.target?.localName !== "input" || operation.type !== "SET_ATTRIBUTE" && operation.type !== "REMOVE_ATTRIBUTE" || operation.name !== "type") {
      continue;
    }
    finalTypes.set(
      operation.target,
      operation.type === "REMOVE_ATTRIBUTE" ? "text" : operation.value.toLowerCase(),
    );
  }
  return finalTypes;
}

function supportsSelectionRange(element, inputType) {
  if (element.localName === "textarea") return true;
  return element.localName === "input" && ["text", "search", "url", "tel", "password"].includes(inputType);
}
