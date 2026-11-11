import { diff, element, fromDOM, patch, toDOM } from "../src/vdom.js";
import { FunctionComponent, h, useEffect, useMemo, useState } from "../src/component.js";
import { StateHistory } from "../src/history.js";
import { createRunStorage, storageKey } from "../src/storage.js";
import { affectedCells, boardAt, createGame, play, restart, restoreGame, toggle, travel } from "../src/puzzle.js";
import { mountGame } from "../src/game.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });

function assert(condition, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

function equal(actual, expected) {
  assert(Object.is(actual, expected), `Expected ${expected}, received ${actual}`);
}

function tree(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return fromDOM(host);
}

test("DOM 변환과 재생성은 텍스트, 주석, SVG를 보존한다", () => {
  const original = tree('<p data-name="demo">안녕<!-- note --><strong>!</strong></p><svg><circle r="4"></circle></svg>');
  const rebuilt = toDOM(original);
  equal(JSON.stringify(fromDOM(rebuilt)), JSON.stringify(original));
  equal(rebuilt.querySelector("circle").namespaceURI, "http://www.w3.org/2000/svg");
  equal(diff(original, fromDOM(rebuilt)).length, 0);
});

test("폼 마크업의 속성을 보존하고 파일 입력을 임의로 채우지 않는다", () => {
  const original = tree('<input type="file" value="sample.txt"><textarea value="기본값"></textarea>');
  const rebuilt = toDOM(original);
  equal(JSON.stringify(fromDOM(rebuilt)), JSON.stringify(original));
  equal(rebuilt.querySelector("input").value, "");
  equal(rebuilt.querySelector("textarea").value, "기본값");
});

test("Diff는 속성, 텍스트, 교체, 삭제를 찾아 필요한 DOM만 수정한다", () => {
  const before = tree('<p class="old">before</p><b>replace</b><i>remove</i><i>remove twice</i>');
  const after = tree('<p title="new">after</p><em>changed</em>');
  const live = toDOM(before);
  const paragraph = live.firstChild;
  const textNode = paragraph.firstChild;
  const changes = diff(before, after);
  equal(changes.map(item => item.kind).join(","), "props,text,replace,remove,remove");
  patch(live, changes);
  equal(live.firstChild, paragraph);
  equal(paragraph.firstChild, textNode);
  equal(live.innerHTML, toDOM(after).innerHTML);
});

test("Patch는 여러 요소 추가와 루트 교체를 처리한다", () => {
  const before = tree("<p>keep</p>");
  const after = tree("<p>keep</p><em>add</em><strong>add twice</strong>");
  const live = toDOM(before);
  const kept = live.firstChild;
  const changes = diff(before, after);
  equal(changes.map(item => item.kind).join(","), "insert,insert");
  patch(live, changes);
  equal(live.firstChild, kept);
  equal(live.innerHTML, toDOM(after).innerHTML);
  const host = document.createElement("main");
  host.append(live);
  const replacement = element("article", {}, "new root");
  equal(patch(live, diff(after, replacement)), host.firstChild);
  equal(host.innerHTML, "<article>new root</article>");
});

test("중간 삽입과 삭제에서도 앞뒤의 같은 노드는 재사용한다", () => {
  const before = tree("<p>첫째</p><p>마지막</p>");
  const after = tree("<p>첫째</p><p>새 항목</p><p>마지막</p>");
  const live = toDOM(before);
  const first = live.firstChild;
  const last = live.lastChild;
  const insert = diff(before, after);
  equal(insert.map(item => item.kind).join(","), "insert");
  patch(live, insert);
  equal(live.firstChild, first);
  equal(live.lastChild, last);
  equal(live.children[1].textContent, "새 항목");
  const remove = diff(after, before);
  equal(remove.map(item => item.kind).join(","), "remove");
  patch(live, remove);
  equal(live.firstChild, first);
  equal(live.lastChild, last);
  equal(live.children.length, 2);
});

test("속성 Patch는 이전 이벤트 핸들러를 교체하고 제거한다", () => {
  const calls = [];
  const before = element("button", { onClick: () => calls.push("old") }, "click");
  const next = element("button", { onClick: () => calls.push("new") }, "click");
  const empty = element("button", {}, "click");
  const button = toDOM(before);
  button.click();
  patch(button, diff(before, next));
  button.click();
  patch(button, diff(next, empty));
  button.click();
  equal(calls.join(","), "old,new");
});

test("히스토리는 경계를 지키고 뒤로 간 뒤 새 상태를 저장하면 앞 기록을 버린다", () => {
  const history = new StateHistory("initial");
  equal(history.move(-1), null);
  history.push("a");
  history.push("b");
  equal(history.move(-1), "a");
  equal(history.move(1), "b");
  equal(history.move(1), null);
  history.move(-1);
  history.push("c");
  equal(history.length, 3);
  equal(history.current, "c");
  equal(history.canForward, false);
});

test("useState는 초기화, 함수형 갱신, 기존 노드 재사용을 지원한다", () => {
  let setCount;
  let initializations = 0;
  let renders = 0;
  const host = document.createElement("div");
  const root = new FunctionComponent(() => {
    renders += 1;
    const [count, set] = useState(() => { initializations += 1; return 0; });
    setCount = set;
    return h("p", {}, count);
  }, host);
  const node = root.mount();
  setCount(value => value + 1);
  setCount(value => value + 1);
  setCount(2);
  equal(initializations, 1);
  equal(renders, 3);
  equal(host.firstChild, node);
  equal(node.textContent, "2");
  root.unmount();
  setCount(9);
  equal(host.childNodes.length, 0);
});

test("useEffect는 DOM 반영 뒤 실행되고 의존성 변경과 제거 때 정리한다", () => {
  const host = document.createElement("div");
  const log = [];
  let set;
  const root = new FunctionComponent(() => {
    const [count, change] = useState(0);
    const [unrelated, setUnrelated] = useState(false);
    set = { change, setUnrelated };
    useEffect(() => {
      log.push(`setup:${host.firstChild.dataset.count}`);
      return () => log.push(`cleanup:${count}`);
    }, [count]);
    return h("div", { "data-count": count }, String(unrelated));
  }, host);
  root.mount();
  set.setUnrelated(true);
  set.change(1);
  root.unmount();
  equal(log.join(","), "setup:0,cleanup:0,setup:1,cleanup:1");
});

test("Effect에서 요청한 상태 변경은 현재 반영이 끝난 뒤 실행된다", () => {
  const host = document.createElement("div");
  const log = [];
  const root = new FunctionComponent(() => {
    const [count, set] = useState(0);
    useEffect(() => {
      log.push(host.textContent);
      if (count === 0) set(1);
    }, [count]);
    return h("p", {}, count);
  }, host);
  root.mount();
  equal(log.join(","), "0,1");
});

test("useMemo는 관련 의존성이 변할 때만 계산한다", () => {
  const host = document.createElement("div");
  let calculations = 0;
  let setCount;
  let setOther;
  const root = new FunctionComponent(() => {
    const [count, set] = useState(2);
    const [other, change] = useState(false);
    setCount = set;
    setOther = change;
    const memo = useMemo(() => { calculations += 1; return count * 3; }, [count]);
    return h("p", {}, memo, String(other));
  }, host);
  root.mount();
  setOther(true);
  equal(calculations, 1);
  setCount(3);
  equal(calculations, 2);
  equal(host.textContent, "9true");
});

test("자식 컴포넌트는 props를 받으며 Hook 호출은 거부된다", () => {
  function Label({ value }) { return h("strong", {}, value); }
  equal(toDOM(h(Label, { value: "props" })).textContent, "props");
  function InvalidChild() { useState(0); return h("p"); }
  const root = new FunctionComponent(() => h(InvalidChild), document.createElement("div"));
  let rejected = false;
  try { root.mount(); } catch (error) { rejected = error.message.includes("root component"); }
  assert(rejected);
});

function loadDemo(url = "../lab.html") {
  return new Promise((done, fail) => {
    const frame = document.createElement("iframe");
    frame.title = "Integration fixture";
    frame.style.cssText = "width:390px;height:600px;position:absolute;left:-5000px;";
    const deadline = setTimeout(() => fail(new Error("Demo iframe did not load")), 5000);
    frame.addEventListener("load", () => { clearTimeout(deadline); done(frame); }, { once: true });
    frame.src = url;
    document.body.append(frame);
  });
}

function input(field, value) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function reloadDemo(frame, action = () => frame.contentWindow.location.reload()) {
  return new Promise((done, fail) => {
    const deadline = setTimeout(() => fail(new Error("Demo iframe did not reload")), 5000);
    frame.addEventListener("load", () => { clearTimeout(deadline); done(); }, { once: true });
    action();
  });
}

test("Phase 1 화면에서 편집, Patch, 히스토리 이동, 빈 영역 복원이 동작한다", async () => {
  const frame = await loadDemo();
  try {
    const doc = frame.contentDocument;
    const $ = selector => doc.querySelector(selector);
    const applied = $("#actual h3");
    const editor = $("#markup");
    const initial = editor.value;
    $("#apply-patch").click();
    equal($("#history-position").textContent, "1 / 1");
    input(editor, initial.replace("이번 주 학습", "React 실험"));
    equal($("#preview h3").textContent, "React 실험");
    equal(applied.textContent, "이번 주 학습");
    $("#apply-patch").click();
    equal($("#actual h3"), applied);
    equal(applied.textContent, "React 실험");
    assert($("#patch-summary").textContent.includes("DOM 변경 기록 1개"));
    $("#history-back").click();
    equal($("#preview h3").textContent, "이번 주 학습");
    assert(editor.value.includes("이번 주 학습"));
    $("#history-forward").click();
    equal($("#preview h3").textContent, "React 실험");
    input(editor, '<script>window.bad = true;</script>');
    $("#apply-patch").click();
    equal($("#actual .sample-content").childNodes.length, 0);
    equal(frame.contentWindow.bad, undefined);
    $("#history-back").click();
    equal($("#actual h3"), $("#actual .sample-content").firstChild);
    equal($("#preview h3").textContent, "React 실험");
    assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, "mobile viewport overflow");
  } finally { frame.remove(); }
});

test("Phase 1은 Patch 후 클릭 코드를 실행하고 Patch 이력을 유지한다", async () => {
  const key = storageKey("lab");
  const previous = localStorage.getItem(key);
  localStorage.removeItem(key);
  let frame;
  try {
    frame = await loadDemo();
    const $ = selector => frame.contentDocument.querySelector(selector);
    input($("#markup"), `<button id="sample-click" onclick="this.textContent = 'clicked'">click</button>
<button id="sample-hidden" onclick="this.hidden = true">stay visible</button>`);
    $("#preview #sample-click").click();
    equal($("#preview #sample-click").textContent, "click");
    equal($("#actual #sample-click"), null);

    $("#apply-patch").click();
    const button = $("#actual #sample-click");
    equal(button.hasAttribute("onclick"), false);
    button.click();
    equal(button.textContent, "clicked");
    equal($("#preview #sample-click").textContent, "click");
    $("#actual #sample-hidden").click();
    equal($("#actual #sample-hidden").hidden, true);

    $("#apply-patch").click();
    equal(button.textContent, "click");
    equal($("#history-position").textContent, "2 / 2");
    $("#history-back").click();
    equal($("#actual #sample-click"), null);
    $("#history-forward").click();
    assert($("#markup").value.includes("onclick="));
    assert(!$("#markup").value.includes("data-lab-onclick"));
    await reloadDemo(frame);
    $("#actual #sample-click").click();
    equal($("#actual #sample-click").textContent, "clicked");
  } finally {
    frame?.remove();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});


test("실험실은 alert, 부모 클릭 전파, this/currentTarget, 전파 중단을 지원한다", async () => {
  localStorage.removeItem(storageKey("lab"));
  const frame = await loadDemo();
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    const messages = [];
    frame.contentWindow.alert = value => messages.push(value);
    input($("#markup"), `<button id="direct" onclick="alert('1234')">aaa</button>
<div id="parent" onclick="alert(this.id + ':' + event.currentTarget.id)">
<button id="child" onclick="alert('child')"><span>nested</span></button>
<button id="stop" onclick="event.stopPropagation(); alert('stop')">stop</button>
<button id="plain">parent only</button></div>`);
    $("#preview #direct").click();
    equal(messages.length, 0);
    $("#apply-patch").click();
    $("#actual #direct").click();
    $("#actual #child span").click();
    $("#actual #plain").click();
    $("#actual #stop").click();
    equal(messages.join(","), "1234,child,parent:parent,parent:parent,stop");
    await reloadDemo(frame);
    frame.contentWindow.alert = value => messages.push(value);
    $("#actual #direct").click();
    equal(messages.at(-1), "1234");
  } finally { frame.remove(); }
});

test("클릭 코드 변경·삭제와 텍스트 수정은 기존 DOM을 유지하며 필요한 부분만 Patch한다", async () => {
  localStorage.removeItem(storageKey("lab"));
  const frame = await loadDemo();
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    const original = `<div id="parent" onclick="this.dataset.clicked = 'yes'"><button id="child">aaa</button><p id="keep">keep</p></div>`;
    input($("#markup"), original);
    $("#apply-patch").click();
    const parent = $("#actual #parent");
    const child = $("#actual #child");
    const kept = $("#actual #keep");
    const text = child.firstChild;
    const handler = parent.onclick;
    const observer = new MutationObserver(() => {});
    observer.observe($("#actual"), { attributes: true, childList: true, characterData: true, subtree: true });
    try {
      input($("#markup"), original.replace(">aaa<", ">bbb<"));
      $("#apply-patch").click();
      const records = observer.takeRecords();
      equal(records.length, 1);
      equal(records[0].type, "characterData");
      equal(child.firstChild, text);
      equal(text.data, "bbb");
      equal(parent.onclick, handler);
      equal($("#actual #parent"), parent);
      equal($("#actual #child"), child);
      equal($("#actual #keep"), kept);
      $("#apply-patch").click();
      equal(observer.takeRecords().length, 0);
      input($("#markup"), original.replace("'yes'", "'updated'"));
      $("#apply-patch").click();
      child.click();
      equal(parent.dataset.clicked, "updated");
      input($("#markup"), original.replace(' onclick="this.dataset.clicked = \'yes\'"', ""));
      $("#apply-patch").click();
      equal(parent.onclick, null);
      equal(parent.dataset.clicked, undefined);
      child.click();
      equal(parent.dataset.clicked, undefined);
      $("#history-back").click();
      child.click();
      equal(parent.dataset.clicked, "updated");
      $("#history-forward").click();
      equal(parent.dataset.clicked, undefined);
      equal($("#actual #child"), child);
      equal($("#actual #keep"), kept);
    } finally { observer.disconnect(); }
  } finally { frame.remove(); }
});

test("클릭이 자식을 바꿔도 Patch가 현재 DOM에서 비교하며 오류 후에도 수정할 수 있다", async () => {
  localStorage.removeItem(storageKey("lab"));
  const frame = await loadDemo();
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    const markup = `<div id="mutate" onclick="this.textContent = 'changed'; event.stopPropagation()"><button>run</button></div><p id="stable">keep</p>`;
    input($("#markup"), markup);
    $("#apply-patch").click();
    const parent = $("#actual #mutate");
    const stable = $("#actual #stable");
    $("#actual button").click();
    equal(parent.textContent, "changed");
    $("#apply-patch").click();
    equal($("#actual #mutate"), parent);
    equal($("#actual #stable"), stable);
    equal(parent.querySelector("button").textContent, "run");
    input($("#markup"), '<button onclick="alert(">broken</button>');
    $("#apply-patch").click();
    assert($("#patch-summary").textContent.includes("문법 오류"));
    input($("#markup"), '<button onclick="alarm(1234)">broken</button>');
    $("#apply-patch").click();
    $("#actual button").click();
    assert($("#patch-summary").textContent.includes("실행 오류"));
    input($("#markup"), '<button onclick="this.textContent = \'fixed\'">run</button>');
    $("#apply-patch").click();
    $("#actual button").click();
    equal($("#actual button").textContent, "fixed");
  } finally { frame.remove(); }
});

test("퍼즐 규칙: 중앙 5칸, 모서리 3칸, 가장자리 4칸만 반전한다", () => {
  const off = Array(25).fill(false);
  equal(affectedCells(12).sort((a, b) => a - b).join(","), "7,11,12,13,17");
  equal(affectedCells(0).sort((a, b) => a - b).join(","), "0,1,5");
  equal(affectedCells(4).sort((a, b) => a - b).join(","), "3,4,9");
  equal(affectedCells(10).sort((a, b) => a - b).join(","), "5,10,11,15");
  equal(affectedCells(24).sort((a, b) => a - b).join(","), "19,23,24");
  equal(toggle(off, 12).filter(Boolean).length, 5);
  equal(off.filter(Boolean).length, 0);
  equal(toggle(toggle(off, 12), 12).filter(Boolean).length, 0);
  for (const index of [-1, 25, null, 1.5, "12"]) equal(affectedCells(index).length, 0);
});

test("생성한 퍼즐 100개는 처음에 불이 켜져 있고 실제 합법적 클릭으로 해결된다", () => {
  let seed = 421;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const boards = new Set();
  for (let count = 0; count < 100; count += 1) {
    let game = createGame(random);
    assert(boardAt(game).some(Boolean));
    boards.add(JSON.stringify(boardAt(game)));
    for (const index of [...game.scramble].reverse()) game = play(game, index);
    equal(boardAt(game).filter(Boolean).length, 0);
    assert(restoreGame(game));
  }
  assert(boards.size > 90, "puzzles should vary");
});

const fixture = () => ({ version: 1, scramble: [0, 12, 24], moves: [], cursor: 0 });

test("이동 이력은 경계를 지키고 분기를 대체하며 같은 퍼즐로 재시작한다", () => {
  const original = fixture();
  equal(travel(original, -1), original);
  equal(play(original, 25), original);
  const first = play(original, 2);
  const second = play(first, 8);
  equal(travel(second, 1), second);
  const back = travel(second, -1);
  equal(JSON.stringify(boardAt(back)), JSON.stringify(boardAt(first)));
  equal(JSON.stringify(boardAt(travel(back, 1))), JSON.stringify(boardAt(second)));
  const branch = play(back, 20);
  equal(branch.moves.join(","), "2,20");
  equal(travel(branch, 1), branch);
  equal(JSON.stringify(restart(branch)), JSON.stringify(original));
  equal(second.moves.join(","), "2,8");
  equal(original.moves.length, 0);
});

test("완료 후 추가 클릭은 막고 되돌리기와 재시작은 허용한다", () => {
  const game = { ...fixture(), scramble: [12] };
  const solved = play(game, 12);
  equal(boardAt(solved).some(Boolean), false);
  equal(play(solved, 0), solved);
  equal(travel(solved, -1).cursor, 0);
  equal(boardAt(travel(solved, -1)).filter(Boolean).length, 5);
  equal(restart(solved).cursor, 0);
});

test("저장값 검증은 손상된 값과 완료 이후의 불가능한 기록을 거부한다", () => {
  const game = travel(play(play(fixture(), 2), 8), -1);
  const restored = restoreGame(JSON.parse(JSON.stringify(game)));
  equal(JSON.stringify(restored), JSON.stringify(game));
  assert(restored !== game && restored.moves !== game.moves);
  for (const value of [null, {}, { ...game, version: 99 }, { ...game, cursor: -1 },
    { ...game, cursor: 20 }, { ...game, moves: [25] }, { ...game, scramble: [] },
    { ...game, scramble: [0, 0] }, { ...game, scramble: [12], moves: [12, 0], cursor: 1 }]) {
    equal(restoreGame(value), null);
  }
});

function gameFixture(value = fixture()) {
  const host = document.createElement("div");
  document.body.append(host);
  const writes = [];
  const storage = { read: () => value, write: (name, game) => writes.push(JSON.parse(JSON.stringify(game))) };
  const root = mountGame(host, storage);
  return { host, root, writes, $: selector => host.querySelector(selector),
    close() { root.unmount(); host.remove(); } };
}

test("게임은 기존 25개 버튼을 재사용하고 중앙 클릭 시 다섯 칸의 켜짐 상태만 Patch한다", () => {
  const game = gameFixture();
  const { $, root } = game;
  const grid = $("#light-grid");
  const buttons = [...grid.children];
  const before = buttons.map(button => button.getAttribute("aria-pressed"));
  const observer = new MutationObserver(() => {});
  observer.observe(grid, { attributes: true, childList: true, subtree: true });
  try {
    buttons[12].querySelector(".light-core").click();
    equal($("#moves").textContent, "1");
    equal($("#light-grid"), grid);
    buttons.forEach((button, index) => equal(grid.children[index], button));
    const changed = buttons.flatMap((button, index) => button.getAttribute("aria-pressed") !== before[index] ? [index] : []);
    equal(changed.join(","), "7,11,12,13,17");
    const records = observer.takeRecords();
    equal(records.filter(record => record.type === "childList").length, 0);
    equal(records.filter(record => record.attributeName === "aria-pressed").length, 5);
    assert(root.lastPatchCount > 0);
    equal(game.writes.at(-1).moves.join(","), "12");
  } finally { observer.disconnect(); game.close(); }
});

test("미리보기·키보드 초점 이동은 이동 기록이나 저장을 증가시키지 않는다", () => {
  const game = gameFixture();
  try {
    const { $ } = game;
    const first = $('[data-cell="0"]');
    const writes = game.writes.length;
    first.focus();
    equal(game.host.querySelectorAll(".is-preview").length, 3);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    equal(document.activeElement, first);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    equal(document.activeElement, $('[data-cell="5"]'));
    equal($("#moves").textContent, "0");
    equal(game.writes.length, writes);
    const boardMemo = game.root.hooks.find(slot => slot.kind === "memo").value;
    $('[data-cell="12"]').focus();
    equal(game.root.hooks.find(slot => slot.kind === "memo").value, boardMemo);
    equal(game.host.querySelectorAll(".is-preview").length, 5);
  } finally { game.close(); }
});

test("승리 화면과 탭 제목이 바뀌고 undo·redo·재시작·새 퍼즐이 상태와 일치한다", () => {
  const game = gameFixture({ ...fixture(), scramble: [12] });
  try {
    const { $ } = game;
    equal($("#undo").disabled, true);
    equal($("#redo").disabled, true);
    $('[data-cell="12"]').click();
    equal($("#remaining").textContent, "0");
    assert($("#game-status").textContent.includes("모든 불을 껐어요"));
    assert(document.title.includes("성공"));
    $('[data-cell="0"]').click();
    equal($("#moves").textContent, "1");
    $("#undo").click();
    equal($("#remaining").textContent, "5");
    equal($("#redo").disabled, false);
    assert(!document.title.includes("성공"));
    $("#redo").click();
    equal($("#remaining").textContent, "0");
    $("#restart").click();
    equal($("#remaining").textContent, "5");
    equal($("#moves").textContent, "0");
    equal($("#redo").disabled, true);
    $("#new-game").click();
    equal($("#moves").textContent, "0");
    assert(Number($("#remaining").textContent) > 0);
    equal(game.writes.at(-1).scramble.length, 5);
  } finally { game.close(); }
});

test("손상된 저장 데이터로도 새 퍼즐을 시작한다", () => {
  const game = gameFixture({ version: 1, moves: "broken", scramble: [99] });
  try {
    equal(game.$("#moves").textContent, "0");
    equal(game.host.querySelectorAll(".light").length, 25);
    assert(restoreGame(game.writes.at(-1)));
  } finally { game.close(); }
});

test("저장소는 실행 ID를 구분하고 잘못된 JSON을 안전하게 무시한다", () => {
  const key = storageKey("storage-test");
  const same = createRunStorage("run-a");
  same.write("storage-test", { count: 2 });
  equal(createRunStorage("run-a").read("storage-test").count, 2);
  equal(createRunStorage("run-b").read("storage-test"), undefined);
  localStorage.setItem(key, "broken");
  equal(same.read("storage-test"), undefined);
  localStorage.removeItem(key);
});

test("별도 VDOM 실험실은 새로고침 시 적용 내용·미적용 초안·앞으로 갈 기록을 복원한다", async () => {
  localStorage.removeItem(storageKey("lab"));
  const frame = await loadDemo();
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    const initial = $("#markup").value;
    input($("#markup"), initial.replace("이번 주 학습", "Patch A"));
    $("#apply-patch").click();
    input($("#markup"), initial.replace("이번 주 학습", "Patch B"));
    $("#apply-patch").click();
    $("#history-back").click();
    input($("#markup"), initial.replace("이번 주 학습", "미적용 초안"));
    await reloadDemo(frame);
    equal($("#actual h3").textContent, "Patch A");
    equal($("#preview h3").textContent, "미적용 초안");
    equal($("#history-position").textContent, "2 / 3");
    $("#history-forward").click();
    equal($("#actual h3").textContent, "Patch B");
  } finally { frame.remove(); }
});

test("실제 페이지에서 새로고침 후 보드·이동 횟수·redo 기록이 복원된다", async () => {
  localStorage.removeItem(storageKey("puzzle"));
  const frame = await loadDemo("../index.html");
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    $('[data-cell="1"]').click();
    $('[data-cell="3"]').click();
    $("#undo").click();
    const before = [...frame.contentDocument.querySelectorAll(".light")].map(button => button.getAttribute("aria-pressed")).join(",");
    await reloadDemo(frame);
    equal($("#moves").textContent, "1");
    equal([...frame.contentDocument.querySelectorAll(".light")].map(button => button.getAttribute("aria-pressed")).join(","), before);
    equal($("#redo").disabled, false);
    $("#redo").click();
    equal($("#moves").textContent, "2");
    assert(frame.contentDocument.documentElement.scrollWidth <= frame.contentDocument.documentElement.clientWidth, "mobile overflow");
  } finally { frame.remove(); }
});

const lifecycle = new URLSearchParams(location.search).get("lifecycle");
const appKeys = () => Object.keys(localStorage).filter(key => key.startsWith(storageKey("")));
if (lifecycle === "restart") {
  tests.length = 0;
  test("서버를 같은 주소로 재시작하면 이전 실행의 게임과 VDOM 실험 기록을 초기화한다", async () => {
    const previous = JSON.parse(localStorage.getItem(storageKey("puzzle")));
    equal(previous.value.cursor, 2);
    equal(JSON.parse(localStorage.getItem(storageKey("lab"))).value.cursor, 2);
    const frame = await loadDemo("../index.html");
    try {
      const $ = selector => frame.contentDocument.querySelector(selector);
      assert($('meta[name="mini-react-run"]').content !== previous.runId);
      equal($("#moves").textContent, "0");
      equal($("#undo").disabled, true);
      equal($("#redo").disabled, true);
      assert(Number($("#remaining").textContent) > 0);
    } finally { frame.remove(); }
    const lab = await loadDemo();
    try {
      equal(lab.contentDocument.querySelector("#actual h3").textContent, "이번 주 학습");
      equal(lab.contentDocument.querySelector("#history-position").textContent, "1 / 1");
    } finally { lab.remove(); }
  });
}

// Manual runs restore existing app data after testing.
const backup = lifecycle === null ? appKeys().map(key => [key, localStorage.getItem(key)]) : [];
if (lifecycle !== "restart") for (const key of appKeys()) localStorage.removeItem(key);
let failures = 0;
for (const { name, run } of tests) {
  const line = document.createElement("li");
  try {
    await run();
    line.className = "pass";
    line.textContent = `PASS ${name}`;
  } catch (error) {
    failures += 1;
    line.className = "fail";
    line.textContent = `FAIL ${name}: ${error.message}`;
  }
  document.querySelector("#results").append(line);
}
if (lifecycle === null) {
  for (const key of appKeys()) localStorage.removeItem(key);
  for (const [key, value] of backup) localStorage.setItem(key, value);
}
document.documentElement.dataset.tests = failures ? "failed" : "passed";
document.querySelector("#result").textContent = `${tests.length - failures}/${tests.length} 통과`;
