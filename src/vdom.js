const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

export function text(value) {
  return { type: "#text", value: String(value) };
}

export function element(type, props = {}, ...children) {
  return {
    type,
    namespace: type === "svg" ? SVG : null,
    props: { ...props },
    children: children.flat(Infinity)
      .filter(child => child != null && typeof child !== "boolean")
      .map(child => typeof child === "object" ? child : text(child)),
  };
}

export function fromDOM(node) {
  if (node.nodeType === 3) return text(node.data);
  if (node.nodeType === 8) return { type: "#comment", value: node.data };
  if (node.nodeType !== 1) throw new TypeError("Expected an element, text, or comment node.");

  return {
    type: node.localName,
    namespace: node.namespaceURI === HTML ? null : node.namespaceURI,
    props: Object.fromEntries(Array.from(node.attributes, attr => [attr.name, attr.value])),
    children: Array.from(node.childNodes, fromDOM),
  };
}

function isEvent(name) {
  return /^on[A-Z]/.test(name);
}

function setProp(node, name, previous, next) {
  if (isEvent(name)) {
    const event = name.slice(2).toLowerCase();
    if (typeof previous === "function") node.removeEventListener(event, previous);
    if (typeof next === "function") node.addEventListener(event, next);
    return;
  }

  // Input properties hold the live values; the attributes hold the HTML defaults.
  if (name === "value" && /^(input|textarea|select)$/.test(node.localName) && node.type !== "file") {
    const value = next == null ? "" : String(next);
    if (node.value !== value) node.value = value;
  }
  if (name === "checked" && node.localName === "input") node.checked = next != null && next !== false;

  if (name.startsWith("xlink:")) {
    if (next == null || next === false) node.removeAttributeNS(XLINK, name.slice(6));
    else node.setAttributeNS(XLINK, name, String(next));
  } else if (next == null || next === false) {
    node.removeAttribute(name);
  } else {
    node.setAttribute(name, next === true ? "" : String(next));
  }
}

export function toDOM(tree, doc = document, inheritedNamespace = null) {
  if (tree.type === "#text") return doc.createTextNode(tree.value);
  if (tree.type === "#comment") return doc.createComment(tree.value);

  const namespace = tree.namespace ?? inheritedNamespace;
  const node = namespace ? doc.createElementNS(namespace, tree.type) : doc.createElement(tree.type);
  const childNamespace = tree.type === "foreignObject" ? null : namespace;
  for (const child of tree.children) node.append(toDOM(child, doc, childNamespace));
  for (const [name, value] of Object.entries(tree.props)) setProp(node, name, undefined, value);
  return node;
}

function sameTree(before, after) {
  if (before === after) return true;
  if (before.type !== after.type || before.namespace !== after.namespace) return false;
  if (before.type === "#text" || before.type === "#comment") return before.value === after.value;

  const names = Object.keys(before.props);
  return names.length === Object.keys(after.props).length
    && names.every(name => Object.hasOwn(after.props, name) && Object.is(before.props[name], after.props[name]))
    && before.children.length === after.children.length
    && before.children.every((child, index) => sameTree(child, after.children[index]));
}

export function diff(previous, next) {
  const patches = [];

  function compare(before, after, path) {
    if (before === after) return;
    if (before.type !== after.type || before.namespace !== after.namespace) {
      patches.push({ kind: "replace", path, tree: after });
      return;
    }
    if (before.type === "#text" || before.type === "#comment") {
      if (before.value !== after.value) patches.push({ kind: "text", path, value: after.value });
      return;
    }

    const propNames = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
    const props = [];
    for (const name of propNames) {
      const oldValue = Object.hasOwn(before.props, name) ? before.props[name] : undefined;
      const newValue = Object.hasOwn(after.props, name) ? after.props[name] : undefined;
      if (!Object.is(oldValue, newValue)) props.push({ name, oldValue, newValue });
    }
    if (props.length) patches.push({ kind: "props", path, props });

    let start = 0;
    let beforeEnd = before.children.length;
    let afterEnd = after.children.length;
    if (beforeEnd !== afterEnd) {
      // Preserve unchanged siblings around the edited range when children are inserted or removed.
      while (start < beforeEnd && start < afterEnd && sameTree(before.children[start], after.children[start])) start += 1;
      while (beforeEnd > start && afterEnd > start && sameTree(before.children[beforeEnd - 1], after.children[afterEnd - 1])) {
        beforeEnd -= 1;
        afterEnd -= 1;
      }
    }

    const commonEnd = Math.min(beforeEnd, afterEnd);
    for (let index = start; index < commonEnd; index += 1) {
      compare(before.children[index], after.children[index], [...path, index]);
    }
    // Remove from right to left so the remaining child indices stay valid.
    for (let index = beforeEnd - 1; index >= commonEnd; index -= 1) {
      patches.push({ kind: "remove", path: [...path, index] });
    }
    for (let index = commonEnd; index < afterEnd; index += 1) {
      patches.push({ kind: "insert", path, index, tree: after.children[index] });
    }
  }

  compare(previous, next, []);
  return patches;
}

function childNamespace(parent) {
  return !parent || parent.namespaceURI === HTML || parent.localName === "foreignObject"
    ? null : parent.namespaceURI;
}

export function patch(root, patches) {
  for (const change of patches) {
    const node = change.path.reduce((parent, index) => parent.childNodes[index], root);
    switch (change.kind) {
      case "text":
        node.data = change.value;
        break;
      case "props":
        for (const prop of change.props) setProp(node, prop.name, prop.oldValue, prop.newValue);
        break;
      case "insert": {
        const child = toDOM(change.tree, node.ownerDocument, childNamespace(node));
        node.insertBefore(child, node.childNodes[change.index] ?? null);
        break;
      }
      case "remove":
        node.remove();
        break;
      case "replace": {
        const replacement = toDOM(change.tree, node.ownerDocument, childNamespace(node.parentElement));
        node.replaceWith(replacement);
        if (node === root) root = replacement;
        break;
      }
      default:
        throw new Error(`Unknown patch: ${change.kind}`);
    }
  }
  return root;
}
