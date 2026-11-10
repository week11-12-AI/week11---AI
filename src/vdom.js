const MANAGED_KEY_ATTRIBUTE = "data-key";

/**
 * Convert a DOM element or text node into a plain Virtual DOM node.
 * The input node is never changed.
 */
export function domToVNode(node) {
  if (node.nodeType === node.TEXT_NODE) {
    return {
      type: "text",
      value: node.nodeValue ?? "",
    };
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    throw new TypeError("Virtual DOM supports only element and text nodes.");
  }

  const attributes = {};

  for (const attribute of node.attributes) {
    if (attribute.name !== MANAGED_KEY_ATTRIBUTE) {
      attributes[attribute.name] = attribute.value;
    }
  }

  const vnode = {
    type: "element",
    tag: node.tagName.toLowerCase(),
    key: node.getAttribute(MANAGED_KEY_ATTRIBUTE),
    attributes,
    children: Array.from(node.childNodes, domToVNode),
  };

  const properties = getLiveFormProperties(node);
  if (Object.keys(properties).length > 0) {
    vnode.properties = properties;
  }

  return vnode;
}

/** Create a real DOM node from a Virtual DOM node. */
export function createDOM(vnode, document = globalThis.document) {
  if (!document) {
    throw new Error("A document is required to create DOM nodes.");
  }

  if (vnode.type === "text") {
    return document.createTextNode(String(vnode.value));
  }

  if (vnode.type !== "element") {
    throw new TypeError(`Unsupported Virtual DOM node type: ${vnode.type}`);
  }

  const element = document.createElement(vnode.tag);

  for (const [name, value] of Object.entries(vnode.attributes ?? {})) {
    if (name !== MANAGED_KEY_ATTRIBUTE) {
      element.setAttribute(name, String(value));
    }
  }

  if (vnode.key != null) {
    element.setAttribute(MANAGED_KEY_ATTRIBUTE, String(vnode.key));
  }

  for (const child of vnode.children ?? []) {
    element.appendChild(createDOM(child, document));
  }

  applyLiveFormProperties(element, vnode.properties);
  return element;
}

function getLiveFormProperties(element) {
  const properties = {};
  const tag = element.tagName.toLowerCase();

  if (tag === "input") {
    if (element.type !== "file") {
      properties.value = element.value;
    }
    properties.checked = element.checked;
  } else if (tag === "textarea") {
    properties.value = element.value;
  } else if (tag === "select" && !element.multiple) {
    properties.value = element.value;
  } else if (tag === "option") {
    properties.selected = element.selected;
  }

  return properties;
}

function applyLiveFormProperties(element, properties = {}) {
  if (element.localName === "select" && element.multiple) {
    return;
  }
  for (const [name, value] of Object.entries(properties)) {
    if (name in element && element[name] !== value) {
      element[name] = value;
    }
  }
}
