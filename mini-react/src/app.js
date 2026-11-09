// mini-react Phase 1 — 페이지 연결
// main.js의 블록들을 버튼에 이어 붙인다. 새 기능은 없고, 순서만 정한다.

const real = document.getElementById("real");          // 화면 (= 설계 문서의 "실제 영역")
const textarea = document.getElementById("test-area"); // HTML 편집기 (= 설계 문서의 "테스트 영역")
const log = document.getElementById("log");            // 마지막 지시서 목록을 보여 주는 곳
const backBtn = document.getElementById("back");
const forwardBtn = document.getElementById("forward");

// ── 로드 ─────────────────────────────────────
// 실제 영역 → V0. 들여쓰기 공백을 없애려고 V0로 실제 영역을 다시 그린다 (diff 번호 = DOM 번호)
const V0 = domToVNode(real.firstElementChild);
real.replaceChildren(createDom(V0));
textarea.value = vnodeToHtml(V0);
const h = createHistory(V0);
updateButtons();

// ── Patch ────────────────────────────────────
// 읽기 → 비교 → 고치기 → 저장
document.getElementById("patch").addEventListener("click", () => {
  const dom = htmlToDom(textarea.value);
  if (!dom || dom.nodeType !== Node.ELEMENT_NODE) {
    show("⚠️ textarea에는 태그 하나로 감싼 HTML이 있어야 해요");
    return;
  }
  const newV = domToVNode(dom);                 // 읽기
  const patches = diff(current(h), newV);       // 비교
  if (patches.length === 0) {
    show("바뀐 곳이 없어요 (지시서 0장)");
    return;
  }
  applyPatches(real, patches);                  // 고치기
  commit(h, newV);                              // 저장
  show(patches);
  updateButtons();
});

// ── ← / → ────────────────────────────────────
// 꺼내기 → 비교 → 고치기 → textarea도 되돌리기
backBtn.addEventListener("click", () => moveTo(back));
forwardBtn.addEventListener("click", () => moveTo(forward));

function moveTo(step) {
  const from = current(h);
  const to = step(h);                           // 꺼내기 (back 또는 forward)
  const patches = diff(from, to);               // 비교
  applyPatches(real, patches);                  // 고치기
  textarea.value = vnodeToHtml(to);             // textarea도 그 시점의 HTML로
  show(patches);
  updateButtons();
}

// ── 화면 도우미 ───────────────────────────────
function show(patchesOrMessage) {
  log.textContent = typeof patchesOrMessage === "string"
    ? patchesOrMessage
    : `지시서 ${patchesOrMessage.length}장  (기록 ${h.index + 1} / ${h.list.length})\n` +
      patchesOrMessage.map((p) => JSON.stringify(p)).join("\n");
}

function updateButtons() {
  backBtn.disabled = h.index === 0;
  forwardBtn.disabled = h.index === h.list.length - 1;
}
