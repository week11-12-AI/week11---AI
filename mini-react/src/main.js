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

// 공백만 있고, 줄바꿈이 들어 있으면 true
function isIndentOnly(text) {
  return /^\s*$/.test(text) && text.includes("\n");
}
