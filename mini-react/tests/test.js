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

// (임시 도구 makeDom은 main.js의 htmlToDom으로 옮겼다)

// ── htmlToDom ────────────────────────────────
// DOM은 그대로 찍어 볼 수 없으니 domToVNode로 바꿔서 비교한다
check(
  "htmlToDom: 정상 HTML",
  domToVNode(htmlToDom('<p class="a">안녕</p>')),
  { type: "p", props: { class: "a" }, children: ["안녕"] }
);

// 11/9 진훈 예측: (가) 에러로 멈춘다 → 깨짐. 브라우저가 빠진 </p>를 채워 넣는다
check(
  "htmlToDom: 안 닫힌 태그도 고쳐서 읽음",
  domToVNode(htmlToDom("<p>안녕")),
  { type: "p", props: {}, children: ["안녕"] }
);

// ── domToVNode ───────────────────────────────
// 11/9 진훈 예측
check(
  "domToVNode: 글자 + 속성",
  domToVNode(htmlToDom('<p class="a">안녕</p>')),
  { type: "p", props: { class: "a" }, children: ["안녕"] }
);

// 11/9 진훈 예측: children: ["p", "안녕"] → 깨짐. 자식 태그는 통째로 VNode가 된다 (재귀)
check(
  "domToVNode: 태그 안의 태그 (재귀)",
  domToVNode(htmlToDom("<div><p>안녕</p></div>")),
  { type: "div", props: {}, children: [
    { type: "p", props: {}, children: ["안녕"] }
  ] }
);

// 11/9 진훈 예측: children 1개 → 맞음. 줄바꿈이 든 공백(들여쓰기) 2개는 버린다
check(
  "domToVNode: 들여쓰기 공백은 버림",
  domToVNode(htmlToDom("<div>\n  <p>안녕</p>\n</div>")),
  { type: "div", props: {}, children: [
    { type: "p", props: {}, children: ["안녕"] }
  ] }
);

// 11/9 진훈 예측: ["안녕 ", [ {b} ]] → 공백 유지는 맞음, b를 [ ]로 한 번 더 감싼 곳이 깨짐
check(
  "domToVNode: 한 줄 안의 공백은 남김",
  domToVNode(htmlToDom("<p>안녕 <b>철수</b></p>")),
  { type: "p", props: {}, children: [
    "안녕 ",
    { type: "b", props: {}, children: ["철수"] }
  ] }
);

// ── createDom ────────────────────────────────
// 11/9 진훈 예측: 왕복(VNode → DOM → VNode)하면 똑같이 돌아온다 → 맞음
const roundTripStart = domToVNode(htmlToDom('<p class="a">안녕 <b>철수</b></p>'));
check(
  "createDom: 왕복하면 같은 VNode",
  domToVNode(createDom(roundTripStart)),
  roundTripStart
);

check(
  "createDom: 만든 DOM의 HTML 모양",
  createDom(roundTripStart).outerHTML,
  '<p class="a">안녕 <b>철수</b></p>'
);

// ── vnodeToHtml ──────────────────────────────
// 11/9 진훈 예측: (가) 한 줄 → 맞음. VNode에 들여쓰기 정보가 없다
check(
  "vnodeToHtml: 한 줄 글자",
  vnodeToHtml({ type: "div", props: {}, children: [
    { type: "p", props: {}, children: ["안녕"] }
  ] }),
  "<div><p>안녕</p></div>"
);

check(
  "vnodeToHtml: 글자로 갔다가 돌아와도 같은 VNode",
  domToVNode(htmlToDom(vnodeToHtml(roundTripStart))),
  roundTripStart
);

// ── diff ─────────────────────────────────────
// 11/9 진훈 예측 5개 (깨진 곳은 정답으로 고쳐 넣음). 테스트용 짧은 VNode 만들기 도구:
const v = (type, props, ...children) => ({ type, props, children });

// 예측: path: 2 → 깨짐. path는 목록, "안녕"은 p의 0번 자식
check("diff TEXT: 글자만 바뀜",
  diff(v("p", {}, "안녕"), v("p", {}, "하이")),
  [{ op: "TEXT", path: [0], value: "하이" }]);

// 예측: [0, 1] → 깨짐. path는 바깥(루트)에서 안쪽 순서
check("diff TEXT: 두 단계 깊이",
  diff(v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수")),
       v("div", {}, v("p", {}, "안녕"), v("b", {}, "영희"))),
  [{ op: "TEXT", path: [1, 0], value: "영희" }]);

// 예측: path [0], props "b" → 깨짐. 루트 자신은 [], 속성은 이름+값
check("diff PROPS: 루트의 속성이 바뀜",
  diff(v("p", { class: "a" }, "안녕"), v("p", { class: "b" }, "안녕")),
  [{ op: "PROPS", path: [], props: { class: "b" } }]);

// 예측: path [0, 1] → 깨짐. 루트는 번호가 없다
check("diff CREATE: 자식이 늘어남",
  diff(v("div", {}, v("p", {}, "안녕")),
       v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수"))),
  [{ op: "CREATE", path: [1], node: v("b", {}, "철수") }]);

// 예측: path: 1 → 숫자는 맞음, path는 항상 목록
check("diff REMOVE: 자식이 없어짐",
  diff(v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수")),
       v("div", {}, v("p", {}, "안녕"))),
  [{ op: "REMOVE", path: [1] }]);

// 예측: 맞음
check("diff REPLACE: 태그 종류가 바뀜",
  diff(v("div", {}, v("p", {}, "안녕")), v("div", {}, v("span", {}, "안녕"))),
  [{ op: "REPLACE", path: [0], node: v("span", {}, "안녕") }]);

check("diff: 안 바뀌면 빈 목록",
  diff(v("p", { class: "a" }, "안녕"), v("p", { class: "a" }, "안녕")),
  []);

check("diff REMOVE 여러 개: 뒤에서부터",
  diff(v("div", {}, v("p", {}, "1"), v("b", {}, "2"), v("i", {}, "3")),
       v("div", {}, v("p", {}, "1"))),
  [{ op: "REMOVE", path: [2] }, { op: "REMOVE", path: [1] }]);

// ── applyPatches ─────────────────────────────
// 11/9 진훈 판정: 기대값 = 새 VNode (불변식: 고친 뒤 실제 영역을 VNode로 바꾸면 새 VNode와 같다)
// 도구: 이전 VNode로 실제 영역을 그리고 → diff → applyPatches → 실제 영역을 다시 VNode로
function patchAndRead(oldV, newV) {
  const area = document.createElement("div");
  area.appendChild(createDom(oldV));
  applyPatches(area, diff(oldV, newV));
  return domToVNode(area.firstChild);
}

const applyCases = [
  ["TEXT", v("p", {}, "안녕"), v("p", {}, "하이")],
  ["TEXT 깊이 2", v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수")),
                  v("div", {}, v("p", {}, "안녕"), v("b", {}, "영희"))],
  ["PROPS 값 바꿈", v("p", { class: "a" }, "안녕"), v("p", { class: "b" }, "안녕")],
  ["PROPS 속성 삭제", v("p", { class: "a", id: "x" }, "안녕"), v("p", { id: "x" }, "안녕")],
  ["CREATE", v("div", {}, v("p", {}, "안녕")),
             v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수"))],
  ["REMOVE", v("div", {}, v("p", {}, "안녕"), v("b", {}, "철수")),
             v("div", {}, v("p", {}, "안녕"))],
  ["REMOVE 여러 개", v("div", {}, v("p", {}, "1"), v("b", {}, "2"), v("i", {}, "3")),
                     v("div", {}, v("p", {}, "1"))],
  ["REPLACE", v("div", {}, v("p", {}, "안녕")), v("div", {}, v("span", {}, "안녕"))],
  ["REPLACE 루트", v("p", {}, "안녕"), v("h1", {}, "안녕")],
  ["글자 ↔ 태그", v("p", {}, "안녕"), v("p", {}, v("b", {}, "안녕"))],
];
for (const [name, oldV, newV] of applyCases) {
  check(`applyPatches ${name}: 고친 뒤 = 새 VNode`, patchAndRead(oldV, newV), newV);
}

// 11/9 진훈 예측 (나): 바뀐 곳만 고친다 → 바뀌지 않은 형제 노드는 "같은 노드 객체" 그대로여야 한다
{
  const oldV = v("ul", {}, v("li", {}, "사과"), v("li", {}, "바나나"));
  const newV = v("ul", {}, v("li", {}, "사과"), v("li", {}, "딸기"));
  const area = document.createElement("div");
  area.appendChild(createDom(oldV));
  const appleBefore = area.firstChild.childNodes[0];
  applyPatches(area, diff(oldV, newV));
  check("applyPatches: 안 바뀐 '사과' li는 같은 노드 그대로",
    area.firstChild.childNodes[0] === appleBefore, true);
}

// ── history ──────────────────────────────────
// VNode 대신 글자 "A", "B"…로 대신한다 (history는 내용을 들여다보지 않음)

// 11/9 진훈 예측 (나): 과거로 간 뒤 Patch하면 옛 미래는 버려진다
{
  const h = createHistory("A");
  commit(h, "B");
  commit(h, "C");
  back(h);          // B를 보는 중
  commit(h, "D");
  check("history: ← 뒤에 Patch하면 옛 미래(C)는 버림", h, { list: ["A", "B", "D"], index: 2 });
}

// 11/9 진훈 예측 (나): 맨 처음에서 ←를 눌러도 index 0 그대로
{
  const h = createHistory("A");
  commit(h, "B");
  back(h);
  back(h);          // 이미 맨 처음인데 한 번 더
  check("history: 처음에서 ← 는 그대로", h.index, 0);
}

// ── Phase 2: FunctionComponent + useState ────
// 테스트용 카운터: 숫자 p + 버튼
function TestCounter() {
  const [count, setCount] = useState(0);
  return h("div", {},
    h("p", {}, count),
    h("button", { onclick: () => setCount(count + 1) }, "+1"));
}
function mountCounter() {
  const area = document.createElement("div");
  const comp = new FunctionComponent(TestCounter, area);
  comp.mount();
  const button = () => area.firstChild.childNodes[1];
  return { area, comp, button };
}

check("mount: 처음 hooks = [0]", mountCounter().comp.hooks, [0]);

// 11/9 진훈 예측 (가): 다시 그릴 때마다 번호를 0부터 다시 세서 칸은 늘지 않는다
{
  const { area, comp, button } = mountCounter();
  button().click(); button().click(); button().click();
  check("useState: 3번 누르면 hooks = [3] (칸은 1개 그대로)", comp.hooks, [3]);
  check("useState: 3번 누르면 화면 숫자 3", area.firstChild.childNodes[0].textContent, "3");
}

// 11/9 진훈 예측 (가): +1 누르면 숫자 글자 하나만 고친다 → 깨짐: TEXT + 버튼 PROPS
// 11/10 판정: 기대값을 고친다. 근거 = "3번 누르면 화면 3"이 통과 (동작은 맞음).
//   버튼 onclick은 그릴 때마다 그때의 count를 품은 새 함수라 diff가 PROPS로 본다.
//   ❔ 원리(클로저)는 useEffect 0 그림 단계에서 이 예제로 다시 본다 (예약).
{
  const { comp, button } = mountCounter();
  button().click();
  check("update: +1 지시서는 TEXT(숫자) + PROPS(버튼 onclick 새 함수)",
    comp.lastPatches.map((p) => `${p.op} ${JSON.stringify(p.path)}`),
    ["TEXT [0,0]", "PROPS [1]"]);
}

// 11/9 진훈 예측 (나): useState는 이름이 아니라 부른 순서로 자기 칸을 찾는다
{
  let setNameOut;
  function TwoStates() {
    const [count] = useState(0);
    const [name, setName] = useState("철수");
    setNameOut = setName;
    return h("p", {}, count, " ", name);
  }
  const comp = new FunctionComponent(TwoStates, document.createElement("div"));
  comp.mount();
  setNameOut("영희");
  check("useState 2개: 순서대로 칸 0, 1", comp.hooks, [0, "영희"]);
}

// ── Phase 2: useEffect ───────────────────────
// 테스트용 컴포넌트: 상태 2개(count, name) + count만 감시하는 effect
//   effect가 실행될 때마다 log에 "그때의 count / 그때 화면에 보이는 글자"를 적는다
function mountEffectTest() {
  const area = document.createElement("div");
  const log = [];
  const set = {};
  function EffectTest() {
    const [count, setCount] = useState(0);
    const [name, setName] = useState("철수");
    set.count = setCount;
    set.name = setName;
    useEffect(function () {
      log.push(`count=${count} 화면=${area.firstChild.childNodes[0].textContent}`);
    }, [count]);
    return h("div", {}, h("p", {}, count), h("p", {}, name));
  }
  const comp = new FunctionComponent(EffectTest, area);
  comp.mount();
  return { log, set };
}

// 11/10 진훈 예측: 처음 그릴 때는 비교할 지난번이 없으니 무조건 실행
check("useEffect: 처음 그리면 실행됨", mountEffectTest().log, ["count=0 화면=0"]);

// 11/10 진훈 예측 (나): count 그대로, 이름만 바꿈 → 감시 목록 [0] vs [0] 같음 → 건너뜀
{
  const { log, set } = mountEffectTest();
  set.name("영희");
  check("useEffect: 감시 값(count) 그대로면 건너뜀", log, ["count=0 화면=0"]);
}

// count가 바뀌면 다시 실행
// + 진훈 설명 "이펙트는 DOM이 완결되고 나서" → effect 안에서 본 화면 글자가 이미 새 값(1)이어야 한다
{
  const { log, set } = mountEffectTest();
  set.count(1);
  check("useEffect: 감시 값이 바뀌면 실행, 그때 화면은 이미 새 값",
    log, ["count=0 화면=0", "count=1 화면=1"]);
}

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
    domToVNode(htmlToDom(html));
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
