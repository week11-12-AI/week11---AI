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

const clickTextAttribute = "data-lab-click-text";
const clickTextPattern = /^\s*this\.textContent\s*=\s*(?:"([^"\\\r\n]*)"|'([^'\\\r\n]*)')\s*;?\s*$/;

function readDraft(source, doc) {
  const template = doc.createElement("template");
  template.innerHTML = source;
  // Treat the supported button action as text data and strip inline handlers.
  for (const node of template.content.querySelectorAll("*")) {
    if (!passiveElements.has(node.localName)) {
      node.remove();
      continue;
    }
    const inlineClick = node.getAttribute("onclick");
    for (const { name, value } of [...node.attributes]) {
      if (/^on/i.test(name) || /^(srcdoc|srcset|autofocus|formaction|contenteditable|tabindex|accesskey)$/i.test(name)
        || (/^(href|src|xlink:href)$/i.test(name) && /^(javascript|vbscript|data):/i.test(value.replace(/[\s\u0000-\u001f]/g, "")))) {
        node.removeAttribute(name);
      }
    }
    if (node.localName === "button") {
      if (inlineClick !== null) {
        const action = clickTextPattern.exec(inlineClick);
        if (action) node.setAttribute(clickTextAttribute, action[1] ?? action[2]);
        else node.removeAttribute(clickTextAttribute);
      }
      if (node.hasAttribute(clickTextAttribute)) node.setAttribute("type", "button");
      else node.setAttribute("inert", "");
    } else if (node.matches("a, details, input, label, select, textarea")) {
      node.setAttribute("inert", "");
    }
  }
  return element("div", { class: "sample-content" }, Array.from(template.content.childNodes, fromDOM));
}

const patchLabels = { text: "텍스트", props: "속성", insert: "추가", remove: "삭제", replace: "교체" };

export function mountLab({ actual, preview, editor, patchButton, back, forward, position, changes, storage }) {
  const doc = actual.ownerDocument;
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
  actual.addEventListener("click", event => {
    const button = event.target.closest?.(`button[${clickTextAttribute}]`);
    if (!button || button.disabled) return;
    event.preventDefault();
    button.textContent = button.getAttribute(clickTextAttribute);
    actualTree = fromDOM(actualRoot);
  });
  patchButton.addEventListener("click", () => {
    updatePreview();
    const next = fromDOM(previewRoot);
    const historyChanges = diff(history.current.tree, next);
    const patches = actualTree === history.current.tree ? historyChanges : diff(actualTree, next);
    actualRoot = patch(actualRoot, patches);
    if (historyChanges.length) history.push({ tree: next, markup: actualRoot.innerHTML });
    actualTree = history.current.tree;
    save();
    showChanges(patches);
  });

  function travel(direction) {
    const next = history.move(direction);
    if (!next) return;
    const patches = diff(actualTree, next.tree);
    actualRoot = patch(actualRoot, patches);
    actualTree = next.tree;
    previewRoot = patch(previewRoot, diff(fromDOM(previewRoot), next.tree));
    editor.value = next.markup;
    save();
    showChanges(patches);
  }

  back.addEventListener("click", () => travel(-1));
  forward.addEventListener("click", () => travel(1));
  syncHistoryControls();
}
