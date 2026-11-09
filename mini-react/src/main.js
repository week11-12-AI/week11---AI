// mini-react Phase 1
// 함수 하나씩: 예측 → 구현 → 실행 비교 → 커밋

// ─────────────────────────────────────────────
// htmlToDom(글자) → DOM
//   글자를 브라우저에게 읽혀서 DOM 노드로 만든다. 맨 바깥 요소 1개를 돌려준다.
//   브라우저 HTML 읽기는 너그럽다: 틀린 HTML도 에러 없이 고쳐서 읽는다.
// ─────────────────────────────────────────────
function htmlToDom(html) {
  // <template>: 화면에 그리지 않고 HTML을 읽기만 하는 상자
  const box = document.createElement("template");
  box.innerHTML = html.trim(); // 앞뒤 공백을 빼야 첫 자식이 요소가 된다
  return box.content.firstChild;
}

// ─────────────────────────────────────────────
// domToVNode(DOM) → VNode
//   VNode 약속: { type, props, children }
//   - 글자 자식은 항상 문자열
//   - 공백 규칙 (React JSX와 같음): 줄바꿈이 든 공백 전용 글자는 버린다
// ─────────────────────────────────────────────
function domToVNode(node) {
  // 글자 노드 → 문자열 그대로
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  // 속성 → { 이름: 값 }   (속성이 없으면 {} 그대로)
  const props = {};
  for (const attr of node.attributes) {
    props[attr.name] = attr.value;
  }

  // 자식 → 목록. 요소는 같은 함수로 다시 바꾼다 (재귀)
  const children = [];
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (isIndentOnly(child.textContent)) continue; // 들여쓰기 공백은 버림
      children.push(child.textContent);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(domToVNode(child));
    }
    // 주석 같은 다른 노드는 무시
  }

  // 브라우저는 태그 이름을 대문자("P")로 준다 → 소문자로 맞춘다
  return { type: node.tagName.toLowerCase(), props, children };
}

// ─────────────────────────────────────────────
// createDom(VNode) → DOM   (domToVNode의 반대 방향)
//   글자 → 글자 노드 / 상자 → 태그를 만들고, 속성을 붙이고, 자식을 재귀로 만들어 붙인다
// ─────────────────────────────────────────────
function createDom(vnode) {
  // 글자 → 글자 노드
  if (typeof vnode === "string") {
    return document.createTextNode(vnode);
  }

  // 상자 → 태그
  const el = document.createElement(vnode.type);

  // 속성 붙이기  { class: "a" } → class="a"
  for (const name in vnode.props) {
    el.setAttribute(name, vnode.props[name]);
  }

  // 자식 붙이기. 자식 상자는 같은 함수로 다시 만든다 (재귀)
  for (const child of vnode.children) {
    el.appendChild(createDom(child));
  }

  return el;
}

// ─────────────────────────────────────────────
// vnodeToHtml(VNode) → 글자   (← / → 때 textarea를 채운다)
//   VNode에는 들여쓰기 정보가 없으므로 한 줄로 만든다
// ─────────────────────────────────────────────
function vnodeToHtml(vnode) {
  // 글자 → 그대로 (단, < > & 는 태그로 오해받지 않게 바꿔 적는다)
  if (typeof vnode === "string") {
    return escapeHtml(vnode);
  }

  // 속성 → ' class="a"' 처럼 앞에 공백을 붙여 이어 쓴다
  let attrs = "";
  for (const name in vnode.props) {
    attrs += ` ${name}="${escapeHtml(vnode.props[name])}"`;
  }

  // 자식 → 각각 글자로 바꿔 이어 붙인다 (재귀)
  const inner = vnode.children.map(vnodeToHtml).join("");

  return `<${vnode.type}${attrs}>${inner}</${vnode.type}>`;
}

// ─────────────────────────────────────────────
// diff(이전 VNode, 새 VNode) → patch 목록   ⭐ 핵심
//   바뀐 곳마다 지시서 { op, path, ... } 를 한 장씩 만든다. 화면은 건드리지 않는다.
//   path: 루트에서 몇 번째 자식으로 내려가는지. 루트 자신은 [].
// ─────────────────────────────────────────────
function diff(oldNode, newNode, path = [], patches = []) {
  // ① 둘 다 글자: 다르면 TEXT
  if (typeof oldNode === "string" && typeof newNode === "string") {
    if (oldNode !== newNode) {
      patches.push({ op: "TEXT", path, value: newNode });
    }
    return patches;
  }

  // ② 글자 ↔ 태그, 또는 태그 종류가 다름: 통째로 REPLACE
  if (typeof oldNode === "string" || typeof newNode === "string" ||
      oldNode.type !== newNode.type) {
    patches.push({ op: "REPLACE", path, node: newNode });
    return patches;
  }

  // ③ 같은 태그: 속성이 다르면 PROPS (바뀐 뒤 속성 전체를 담는다)
  if (!sameProps(oldNode.props, newNode.props)) {
    patches.push({ op: "PROPS", path, props: newNode.props });
  }

  // ④ 자식을 번호끼리 짝지어 비교한다
  const oldKids = oldNode.children;
  const newKids = newNode.children;
  const shared = Math.min(oldKids.length, newKids.length);

  // 양쪽에 다 있는 번호 → 같은 함수로 다시 비교 (재귀). path에 번호 하나를 붙여 내려간다
  for (let i = 0; i < shared; i++) {
    diff(oldKids[i], newKids[i], [...path, i], patches);
  }

  // 새 쪽에만 있는 번호 → CREATE
  for (let i = shared; i < newKids.length; i++) {
    patches.push({ op: "CREATE", path: [...path, i], node: newKids[i] });
  }

  // 이전 쪽에만 있는 번호 → REMOVE. 뒤에서부터 지운다
  // (앞에서 지우면 뒤 자식들의 번호가 한 칸씩 당겨져서 엉뚱한 걸 지운다)
  for (let i = oldKids.length - 1; i >= shared; i--) {
    patches.push({ op: "REMOVE", path: [...path, i] });
  }

  return patches;
}

// 속성 이름과 값이 모두 같으면 true (적힌 순서는 상관없음)
function sameProps(a, b) {
  const aNames = Object.keys(a);
  if (aNames.length !== Object.keys(b).length) return false;
  return aNames.every((name) => a[name] === b[name]);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// 공백만 있고, 줄바꿈이 들어 있으면 true
function isIndentOnly(text) {
  return /^\s*$/.test(text) && text.includes("\n");
}
