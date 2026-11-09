// 테스트 — 함수마다 사용자가 먼저 적은 "작은 입력 → 기대 출력"을 여기에 넣는다

// ── 도구 ──────────────────────────────────────
const results = document.getElementById("results");
let passCount = 0;
let failCount = 0;

// 실제 값과 기대 값을 글자로 바꿔 비교한다
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  ok ? passCount++ : failCount++;

  const line = document.createElement("pre");
  line.className = ok ? "pass" : "fail";
  line.textContent = ok
    ? `✅ ${name}`
    : `❌ ${name}\n   기대: ${e}\n   실제: ${a}`;
  results.appendChild(line);
  console.log(line.textContent);
}

// 테스트용 DOM 만들기 (htmlToDom을 구현하기 전까지 쓰는 임시 도구)
function makeDom(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// ── domToVNode ───────────────────────────────
// 11/9 진훈 예측
check(
  "domToVNode: 글자 + 속성",
  domToVNode(makeDom('<p class="a">안녕</p>')),
  { type: "p", props: { class: "a" }, children: ["안녕"] }
);

// 11/9 진훈 예측: children: ["p", "안녕"] → 깨짐. 자식 태그는 통째로 VNode가 된다 (재귀)
check(
  "domToVNode: 태그 안의 태그 (재귀)",
  domToVNode(makeDom("<div><p>안녕</p></div>")),
  { type: "div", props: {}, children: [
    { type: "p", props: {}, children: ["안녕"] }
  ] }
);

// 11/9 진훈 예측: children 1개 → 맞음. 줄바꿈이 든 공백(들여쓰기) 2개는 버린다
check(
  "domToVNode: 들여쓰기 공백은 버림",
  domToVNode(makeDom("<div>\n  <p>안녕</p>\n</div>")),
  { type: "div", props: {}, children: [
    { type: "p", props: {}, children: ["안녕"] }
  ] }
);

// 11/9 진훈 예측: ["안녕 ", [ {b} ]] → 공백 유지는 맞음, b를 [ ]로 한 번 더 감싼 곳이 깨짐
check(
  "domToVNode: 한 줄 안의 공백은 남김",
  domToVNode(makeDom("<p>안녕 <b>철수</b></p>")),
  { type: "p", props: {}, children: [
    "안녕 ",
    { type: "b", props: {}, children: ["철수"] }
  ] }
);

// ── 재귀 호출 순서 보기 (테스트 아님, 관찰용) ─────────
// main.js는 그대로 두고, domToVNode를 잠깐 "기록하는 함수"로 감싼다.
// 안쪽 재귀 호출도 같은 이름(domToVNode)을 부르므로 감싼 쪽을 거친다.
function traceDomToVNode(html) {
  const original = domToVNode;
  const lines = [];
  let depth = 0;

  domToVNode = function (node) {
    const pad = "    ".repeat(depth);
    const name = `<${node.tagName.toLowerCase()}>`;
    lines.push(`${pad}${name} 시작`);
    depth++;
    const result = original(node);
    depth--;
    lines.push(`${pad}${name} 끝 → ${JSON.stringify(result)}`);
    return result;
  };

  try {
    domToVNode(makeDom(html));
  } finally {
    domToVNode = original; // 원래 함수로 되돌림
  }

  const out = `[호출 순서] ${html}\n` + lines.join("\n");
  console.log(out);
  const pre = document.createElement("pre");
  pre.textContent = "\n" + out;
  results.appendChild(pre);
}

traceDomToVNode("<div><p>안녕</p></div>");
traceDomToVNode("<div><p>안녕</p><b>철수</b></div>"); // 11/9 진훈 예측: p 시작·끝 → b 시작·끝 (같은 깊이)

// ── 요약 ─────────────────────────────────────
document.getElementById("summary").textContent =
  `통과 ${passCount} / 실패 ${failCount}`;
