import { diff, element, fromDOM, patch, toDOM } from "./vdom.js";
import { StateHistory } from "./history.js";

const passiveElements = new Set([
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "button", "caption", "code", "dd", "details",
  "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "i", "img", "input", "kbd", "label", "li", "main", "mark", "nav", "ol", "option", "p", "picture",
  "pre", "q", "s", "section", "select", "small", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "u", "ul", "svg", "circle", "ellipse",
  "g", "line", "path", "polygon", "polyline", "rect", "text", "title",
]);

const clickAttribute = "data-lab-onclick";
const legacyClickAttribute = "data-lab-click-text";

function readDraft(source, doc) {
  const template = doc.createElement("template");
  template.innerHTML = source;
  // Keep click source as serializable VDOM data. Only the actual area binds it.
  for (const node of template.content.querySelectorAll("*")) {
    if (!passiveElements.has(node.localName)) {
      node.remove();
      continue;
    }
    const inlineClick = node.getAttribute("onclick");
    if (inlineClick !== null) node.setAttribute(clickAttribute, inlineClick);
    else if (node.hasAttribute(legacyClickAttribute) && !node.hasAttribute(clickAttribute)) {
      node.setAttribute(clickAttribute, `this.textContent = ${JSON.stringify(node.getAttribute(legacyClickAttribute))}`);
    }
    node.removeAttribute(legacyClickAttribute);
    for (const { name, value } of [...node.attributes]) {
      if (/^on/i.test(name) || /^(srcdoc|srcset|autofocus|formaction|contenteditable|tabindex|accesskey)$/i.test(name)
        || (/^(href|src|xlink:href)$/i.test(name) && /^(javascript|vbscript|data):/i.test(value.replace(/[\s\u0000-\u001f]/g, "")))) {
        node.removeAttribute(name);
      }
    }
    if (node.localName === "button") {
      node.setAttribute("type", "button");
    } else if (node.matches("a, details, input, label, select, textarea")) {
      node.setAttribute("inert", "");
    }
  }
  return element("div", { class: "sample-content" }, Array.from(template.content.childNodes, fromDOM));
}

const patchLabels = { text: "텍스트", props: "속성", insert: "추가", remove: "삭제", replace: "교체" };

function editableMarkup(root) {
  const snapshot = root.cloneNode(true);
  for (const node of snapshot.querySelectorAll(`[${clickAttribute}]`)) {
    node.setAttribute("onclick", node.getAttribute(clickAttribute));
    node.removeAttribute(clickAttribute);
  }
  return snapshot.innerHTML;
}

export function mountLab({ actual, preview, editor, patchButton, back, forward, position, changes, storage }) {
  const doc = actual.ownerDocument;
  const clickBindings = new WeakMap();

  function bindClicks() {
    for (const node of actualRoot.querySelectorAll("*")) {
      const source = node.getAttribute(clickAttribute);
      if (clickBindings.get(node) === source) continue;
      if (source === null) {
        if (clickBindings.has(node)) node.onclick = null;
      } else {
        try {
          // Use this document's realm so alert, document and window refer to the lab.
          const handler = new doc.defaultView.Function("event", source);
          node.onclick = function (event) {
            try {
              return handler.call(this, event);
            } catch (error) {
              changes.textContent = `onclick 실행 오류: ${error.message}`;
            }
          };
        } catch (error) {
          node.onclick = null;
          changes.textContent = `onclick 문법 오류: ${error.message}`;
        }
      }
      clickBindings.set(node, source);
    }
  }

  let actualRoot = actual.firstElementChild;
  const initial = { tree: fromDOM(actualRoot), markup: actualRoot.innerHTML };
  const saved = storage?.read("lab");
  const valid = Array.isArray(saved?.entries) && saved.entries.every(entry => typeof entry === "string")
    && Number.isInteger(saved.cursor) && saved.cursor >= 0 && saved.cursor < saved.entries.length;
  const history = new StateHistory(initial, valid ? {
    entries: saved.entries.map(markup => ({ tree: readDraft(markup, doc), markup })),
    cursor: saved.cursor,
  } : undefined);
  let actualTree = history.current.tree;
  actualRoot = patch(actualRoot, diff(initial.tree, actualTree));
  bindClicks();
  editor.value = valid && typeof saved.draft === "string" ? saved.draft : history.current.markup;
  const previewTree = editor.value === history.current.markup ? history.current.tree : readDraft(editor.value, doc);
  let previewRoot = toDOM(previewTree, doc);
  preview.append(previewRoot);

  const observer = new MutationObserver(() => {});
  observer.observe(actual, { attributes: true, characterData: true, childList: true, subtree: true });

  function syncHistoryControls() {
    back.disabled = !history.canBack;
    forward.disabled = !history.canForward;
    position.textContent = `${history.position + 1} / ${history.length}`;
  }

  function showChanges(patches) {
    const observed = observer.takeRecords().length;
    const summary = patches.length === 0
      ? "변경 없음"
      : patches.map(change => patchLabels[change.kind]).join(" · ");
    changes.textContent = `Patch ${patches.length}개 · DOM 변경 기록 ${observed}개 | ${summary}`;
    syncHistoryControls();
  }

  function updatePreview() {
    const next = readDraft(editor.value, doc);
    previewRoot = patch(previewRoot, diff(fromDOM(previewRoot), next));
  }

  function save() {
    const { entries, cursor } = history.snapshot();
    storage?.write("lab", { entries: entries.map(entry => entry.markup), cursor, draft: editor.value });
  }

  editor.addEventListener("input", () => {
    updatePreview();
    save();
  });
  patchButton.addEventListener("click", () => {
    updatePreview();
    const next = fromDOM(previewRoot);
    const historyChanges = diff(history.current.tree, next);
    // A click handler may have changed text, attributes or children since the last Patch.
    actualTree = fromDOM(actualRoot);
    const patches = diff(actualTree, next);
    observer.takeRecords();
    actualRoot = patch(actualRoot, patches);
    if (historyChanges.length) history.push({ tree: next, markup: editableMarkup(actualRoot) });
    actualTree = history.current.tree;
    save();
    showChanges(patches);
    bindClicks();
  });

  function travel(direction) {
    const next = history.move(direction);
    if (!next) return;
    actualTree = fromDOM(actualRoot);
    const patches = diff(actualTree, next.tree);
    observer.takeRecords();
    actualRoot = patch(actualRoot, patches);
    actualTree = next.tree;
    previewRoot = patch(previewRoot, diff(fromDOM(previewRoot), next.tree));
    editor.value = next.markup;
    save();
    showChanges(patches);
    bindClicks();
  }

  back.addEventListener("click", () => travel(-1));
  forward.addEventListener("click", () => travel(1));
  syncHistoryControls();
}
