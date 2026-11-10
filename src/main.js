import { createDOM, domToVNode } from "./vdom.js";
import { diff } from "./diff.js";
import { patch } from "./patch.js";

// Capture controls before user-editable id attributes can duplicate their names.
const controls = new Map([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
const $ = (selector) => controls.get(selector.slice(1));
const actual = $("#actual");
const editor = $("#editor");
let actualRoot = actual.firstElementChild;
let editorRoot;
let selected = null;
let keyCounter = 0;
let cursor = 0;

function elements(root) {
  return [root, ...root.querySelectorAll("*")];
}

function freshKey() {
  const used = new Set([...actual.querySelectorAll("[data-key]"), ...editor.querySelectorAll("[data-key]")]
    .map((element) => element.getAttribute("data-key")));
  let key;
  do { key = `node-${++keyCounter}`; } while (used.has(key));
  return key;
}

function ensureKeys(root) {
  for (const element of elements(root)) {
    if (!element.getAttribute("data-key")) element.setAttribute("data-key", freshKey());
  }
}

ensureKeys(actualRoot);
const history = [domToVNode(actualRoot)];

function renderEditor(vnode) {
  editorRoot = createDOM(vnode);
  editor.replaceChildren(editorRoot);
  selected = null;
  showSelection();
}

function select(element) {
  selected = element && editorRoot.contains(element) && element !== editorRoot ? element : null;
  showSelection();
  preview();
}

function showSelection() {
  const active = selected && editorRoot.contains(selected);
  if (!active) selected = null;
  const picker = $("#element-picker");
  picker.replaceChildren(new Option("선택 없음", ""));
  for (const element of elements(editorRoot).slice(1)) {
    picker.add(new Option(`${element.localName} · ${element.getAttribute("data-key")}`, selectorFor(element)));
  }
  picker.value = selected ? selectorFor(selected) : "";
  $("#selection").textContent = selected
    ? `${selected.localName} · key="${selected.getAttribute("data-key")}"`
    : "선택 없음 — 추가한 요소는 루트 마지막에 들어갑니다.";
  $("#key-value").value = selected?.getAttribute("data-key") ?? "";
  $("#selected-attributes").textContent = selected
    ? JSON.stringify(Object.fromEntries([...selected.attributes].map(({ name, value }) => [name, value])), null, 2) : "";
  for (const id of ["delete", "set-attribute", "remove-attribute", "set-key", "renew-key", "select-parent"]) {
    $(`#${id}`).disabled = !selected;
  }
  $("#move-up").disabled = !selected?.previousSibling;
  $("#move-down").disabled = !selected?.nextSibling;
}

// Use external CSS markers so editor-only selection/error state never enters the VDOM.
function selectorFor(element) {
  const path = [];
  while (element !== editor) {
    path.unshift(`:nth-child(${[...element.parentElement.children].indexOf(element) + 1})`);
    element = element.parentElement;
  }
  return `#editor > ${path.join(" > ")}`;
}

function findDuplicates() {
  const duplicates = new Set();
  for (const parent of elements(editorRoot)) {
    const seen = new Map();
    for (const child of parent.children) {
      const key = child.getAttribute("data-key");
      if (seen.has(key)) {
        duplicates.add(seen.get(key));
        duplicates.add(child);
      } else seen.set(key, child);
    }
  }
  return [...duplicates];
}

function preview() {
  // Native select-all/delete can remove the editable tree's wrapper.
  // Keep one stable root and bring any browser-created siblings back under it.
  if (editor.childNodes.length !== 1 || editor.firstChild !== editorRoot) {
    const children = [...editor.childNodes].flatMap((node) =>
      node === editorRoot ? [...editorRoot.childNodes] : [node]);
    editorRoot.replaceChildren(...children);
    editor.replaceChildren(editorRoot);
  }
  ensureKeys(editorRoot);
  showSelection();
  const duplicates = findDuplicates();
  $("#editor-markers").textContent = [
    selected ? `${selectorFor(selected)} { outline: 2px solid #2356bb; outline-offset: 3px; }` : "",
    ...duplicates.map((node) => `${selectorFor(node)} { outline: 3px dashed #b22222; outline-offset: 1px; }`),
  ].join("\n");
  $("#key-errors").textContent = duplicates.length
    ? `중복 key: ${[...new Set(duplicates.map((node) => node.getAttribute("data-key")))].join(", ")} — 빨간 테두리 요소를 선택하고 새 key를 발급하세요.` : "";
  let changes;
  try {
    changes = diff(history[cursor], domToVNode(editorRoot));
    $("#changes").textContent = JSON.stringify(changes, null, 2);
  } catch (error) {
    $("#changes").textContent = error.message;
  }
  $("#patch-button").disabled = !changes;
  $("#dirty").textContent = changes?.length === 0 ? "적용 완료" : "미적용 변경 있음";
  $("#history-position").textContent = `히스토리 ${cursor + 1} / ${history.length}`;
  $("#back").disabled = cursor === 0;
  $("#forward").disabled = cursor === history.length - 1;
  $("#vdom").textContent = JSON.stringify(history[cursor], null, 2);
  return changes;
}

function status(message, error = false) {
  $("#patch-status").textContent = message;
  $("#patch-status").toggleAttribute("data-error", error);
}

function apply(changes) {
  const nextRoot = patch(actualRoot, changes);
  if (actualRoot !== nextRoot) actual.replaceChildren(nextRoot);
  actualRoot = nextRoot;
}

$("#patch-button").addEventListener("click", () => {
  try {
    const changes = preview();
    if (!changes) throw new Error("key 충돌이나 변환 오류를 먼저 해결하세요.");
    if (!changes.length) return status("변경 사항이 없습니다.");
    const next = domToVNode(editorRoot);
    apply(changes);
    history.splice(cursor + 1);
    history.push(structuredClone(next));
    cursor += 1;
    preview();
    status(`${changes.length}개 변경을 적용했습니다.`);
  } catch (error) { status(`Patch 오류: ${error.message}`, true); }
});

function navigate(offset) {
  const nextCursor = cursor + offset;
  if (nextCursor < 0 || nextCursor >= history.length) return;
  const changes = preview();
  if ((!changes || changes.length) && !window.confirm("적용하지 않은 변경을 버리고 히스토리를 이동할까요?")) return;
  try {
    const next = history[nextCursor];
    apply(diff(history[cursor], next));
    cursor = nextCursor;
    renderEditor(next);
    preview();
    status("히스토리를 이동했습니다.");
  } catch (error) { status(`히스토리 오류: ${error.message}`, true); }
}
$("#back").addEventListener("click", () => navigate(-1));
$("#forward").addEventListener("click", () => navigate(1));

editor.addEventListener("click", (event) => {
  // Sample buttons must not submit/navigate; inputs keep their native behavior.
  if (event.target.closest("button, a")) event.preventDefault();
  select(event.target);
});
editor.addEventListener("focusin", (event) => {
  if (event.target !== editor) select(event.target);
});
editor.addEventListener("input", () => preview());
editor.addEventListener("change", () => preview());
editor.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  if (event.target.matches("input, textarea")) {
    const input = event.target;
    input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, "end");
  } else {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  preview();
});
editor.addEventListener("drop", (event) => event.preventDefault());

function edit(action) {
  try {
    action();
    preview();
    status("테스트 영역을 변경했습니다. Patch로 적용하세요.");
  } catch (error) { status(error.message, true); }
}

$("#add").addEventListener("click", () => edit(() => {
  const tag = $("#new-tag").value;
  const node = document.createElement(tag);
  const text = $("#new-text").value;
  if (tag === "input" || tag === "textarea") node.value = text;
  else node.textContent = text;
  node.setAttribute("data-key", freshKey());
  if (selected) selected.after(node);
  else editorRoot.appendChild(node);
  selected = node;
}));
$("#delete").addEventListener("click", () => edit(() => {
  selected.remove();
  selected = null;
}));
$("#move-up").addEventListener("click", () => edit(() => {
  selected.previousSibling?.before(selected);
}));
$("#move-down").addEventListener("click", () => edit(() => {
  selected.nextSibling?.after(selected);
}));
$("#select-parent").addEventListener("click", () => select(selected?.parentElement));
$("#clear-selection").addEventListener("click", () => select(null));
$("#element-picker").addEventListener("change", (event) => {
  select(event.target.value ? editor.querySelector(event.target.value) : null);
});
$("#set-key").addEventListener("click", () => edit(() => {
  const key = $("#key-value").value.trim();
  if (!key) throw new Error("key를 입력하거나 새 key 발급을 사용하세요.");
  selected.setAttribute("data-key", key);
}));
$("#renew-key").addEventListener("click", () => edit(() => selected.setAttribute("data-key", freshKey())));

function updateAttribute(remove) {
  edit(() => {
    const name = $("#attribute-name").value;
    const value = $("#attribute-value").value;
    if (name === "type" && (selected.localName !== "input" || !remove && !["text", "checkbox"].includes(value))) {
      throw new Error("type은 input의 text·checkbox만 지원합니다.");
    }
    if (name === "value" && !["input", "textarea", "option"].includes(selected.localName)) {
      throw new Error("value는 입력 요소에서 설정하세요.");
    }
    if (name === "checked" && (selected.localName !== "input" || selected.type !== "checkbox")) {
      throw new Error("checked는 체크박스에서 설정하세요.");
    }
    if (remove) selected.removeAttribute(name);
    else selected.setAttribute(name, value);
    if (name === "value") selected.value = remove ? "" : value;
    if (name === "checked") selected.checked = !remove;
  });
}
$("#set-attribute").addEventListener("click", () => updateAttribute(false));
$("#remove-attribute").addEventListener("click", () => updateAttribute(true));

renderEditor(history[0]);
preview();
status("테스트 영역을 편집해 보세요.");
