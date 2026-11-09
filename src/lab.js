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

function readDraft(source, doc) {
  const template = doc.createElement("template");
  template.innerHTML = source;
  // The editor previews passive markup rather than executing pasted code.
  for (const node of template.content.querySelectorAll("*")) {
    if (!passiveElements.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const { name, value } of [...node.attributes]) {
      if (/^on/i.test(name) || /^(srcdoc|srcset|autofocus|formaction)$/i.test(name)
        || (/^(href|src|xlink:href)$/i.test(name) && /^(javascript|vbscript|data):/i.test(value.replace(/[\s\u0000-\u001f]/g, "")))) {
        node.removeAttribute(name);
      }
    }
  }
  return element("div", { class: "sample-content" }, Array.from(template.content.childNodes, fromDOM));
}

const patchLabels = { text: "텍스트", props: "속성", insert: "추가", remove: "삭제", replace: "교체" };

export function mountLab({ actual, preview, editor, patchButton, back, forward, position, changes }) {
  const doc = actual.ownerDocument;
  let actualRoot = actual.firstElementChild;
  const initial = fromDOM(actualRoot);
  const history = new StateHistory(initial);
  let previewRoot = toDOM(initial, doc);
  preview.append(previewRoot);
  editor.value = actualRoot.innerHTML;

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

  editor.addEventListener("input", updatePreview);
  patchButton.addEventListener("click", () => {
    updatePreview();
    const next = fromDOM(previewRoot);
    const patches = diff(history.current, next);
    actualRoot = patch(actualRoot, patches);
    if (patches.length) history.push(next);
    showChanges(patches);
  });

  function travel(direction) {
    const previous = history.current;
    const next = history.move(direction);
    if (!next) return;
    const patches = diff(previous, next);
    actualRoot = patch(actualRoot, patches);
    previewRoot = patch(previewRoot, diff(fromDOM(previewRoot), next));
    editor.value = actualRoot.innerHTML;
    showChanges(patches);
  }

  back.addEventListener("click", () => travel(-1));
  forward.addEventListener("click", () => travel(1));
  syncHistoryControls();
}
