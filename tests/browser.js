import { diff, element, fromDOM, patch, toDOM } from "../src/vdom.js";
import { FunctionComponent, h, useEffect, useMemo, useState } from "../src/component.js";
import { StateHistory } from "../src/history.js";
import { storageKey } from "../src/storage.js";

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

function loadDemo() {
  return new Promise((done, fail) => {
    const frame = document.createElement("iframe");
    frame.title = "Integration fixture";
    frame.style.cssText = "width:390px;height:600px;position:absolute;left:-5000px;";
    const deadline = setTimeout(() => fail(new Error("Demo iframe did not load")), 5000);
    frame.addEventListener("load", () => { clearTimeout(deadline); done(frame); }, { once: true });
    frame.src = "../index.html";
    document.body.append(frame);
  });
}

function input(field, value) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function reloadDemo(frame) {
  return new Promise((done, fail) => {
    const deadline = setTimeout(() => fail(new Error("Demo iframe did not reload")), 5000);
    frame.addEventListener("load", () => { clearTimeout(deadline); done(); }, { once: true });
    frame.contentWindow.location.reload();
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

test("Phase 1은 Patch 후 지원하는 버튼 동작만 실행하고 Patch 이력을 유지한다", async () => {
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
    equal($("#actual #sample-hidden").hidden, false);

    $("#apply-patch").click();
    equal(button.textContent, "click");
    equal($("#history-position").textContent, "2 / 2");
    $("#history-back").click();
    equal($("#actual #sample-click"), null);
    $("#history-forward").click();
    await reloadDemo(frame);
    $("#actual #sample-click").click();
    equal($("#actual #sample-click").textContent, "clicked");
  } finally {
    frame?.remove();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});

test("T07: 공백만 입력하면 댓글을 등록할 수 없다", async () => {
  const key = storageKey("comments");
  const previous = localStorage.getItem(key);
  localStorage.removeItem(key);
  let frame;
  try {
    frame = await loadDemo();
    const $ = selector => frame.contentDocument.querySelector(selector);
    $("#toggle-composer").click();
    const form = $("#comment-form");
    const submit = form.querySelector("button[type=submit]");

    input($("#comment-draft"), " \t\n ");
    equal(submit.disabled, true);
    submit.click();
    form.requestSubmit();

    equal($("#comment-list"), null);
    equal($("#comment-summary").textContent, "댓글 0개 · 총 0자");
  } finally {
    frame?.remove();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});

test("Phase 2에서 좋아요와 댓글이 갱신되고 작성창 밖의 노드를 유지한다", async () => {
  const frame = await loadDemo();
  try {
    const doc = frame.contentDocument;
    const $ = selector => doc.querySelector(selector);
    const title = $("#post-title");
    const like = $("#like-button");
    const summary = $("#comment-summary");
    equal(like.textContent, "좋아요 0");
    for (let count = 0; count < 10; count += 1) like.click();
    equal($("#like-button"), like);
    equal(like.textContent, "좋아요 10");
    assert($("#popular-badge"));
    assert(doc.title.endsWith("좋아요 10"));
    $("#toggle-composer").click();
    const draft = $("#comment-draft");
    input(draft, "DOM 노드 유지");
    equal($("#comment-draft"), draft);
    like.click();
    equal(draft.value, "DOM 노드 유지");
    $("#toggle-composer").click();
    equal($("#comment-draft"), null);
    $("#toggle-composer").click();
    equal($("#comment-draft").value, "DOM 노드 유지");
    $("#comment-form button").click();
    equal($("#comment-list .comment-text").textContent, "DOM 노드 유지");
    const registeredAt = $("#comment-list time");
    assert(Number.isFinite(Date.parse(registeredAt.dateTime)));
    assert(/^\d{2}:\d{2}$/.test(registeredAt.textContent), "registration time must show only hours and minutes");
    const replyButton = registeredAt.nextElementSibling;
    assert(replyButton.matches(".reply-toggle"), "registration time must precede the reply button");
    assert(replyButton.nextElementSibling.matches(".comment-like"), "reply must precede the like button");
    equal($("#comment-draft").value, "");
    equal($("#comment-summary"), summary);
    equal(summary.textContent, "댓글 1개 · 총 9자");
    equal($("#post-title"), title);
  } finally { frame.remove(); }
});

test("댓글은 좋아요 순으로 정렬하고 10개부터 1위에 인기 표시를 붙인다", async () => {
  const key = storageKey("comments");
  const previous = localStorage.getItem(key);
  const frame = await loadDemo();
  try {
    const runId = frame.contentDocument.querySelector('meta[name="mini-react-run"]').content;
    localStorage.setItem(key, JSON.stringify({ runId, value: { comments: ["첫 댓글", "둘째 댓글"] } }));
    await reloadDemo(frame);
    const doc = frame.contentDocument;
    const $ = selector => doc.querySelector(selector);
    const order = () => [...doc.querySelectorAll("#comment-list .comment-text")].map(node => node.textContent).join(",");
    const winner = () => $("#comment-list .badge")?.closest("li").querySelector(".comment-text").textContent;

    equal(order(), "첫 댓글,둘째 댓글");
    equal($("#comment-list .badge"), null);
    equal($("#comment-list .comment-time").textContent, "시간 미기록");
    equal($('[data-comment-index="0"]').textContent, "좋아요 0");
    const second = $('[data-comment-index="1"]');
    second.focus();
    second.click();
    equal(order(), "둘째 댓글,첫 댓글");
    equal(doc.activeElement, $('[data-comment-index="1"]'));
    for (let count = 1; count < 9; count += 1) $('[data-comment-index="1"]').click();
    equal($("#comment-list .badge"), null);
    $('[data-comment-index="1"]').click();
    equal(winner(), "둘째 댓글");

    for (let count = 0; count < 10; count += 1) $('[data-comment-index="0"]').click();
    equal(order(), "첫 댓글,둘째 댓글");
    equal(winner(), "첫 댓글");
    equal(doc.querySelectorAll("#comment-list .badge").length, 1);
    equal($('[data-comment-index="0"]').textContent, "좋아요 10");
    equal($('[data-comment-index="1"]').textContent, "좋아요 10");
  } finally {
    frame.remove();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});

const lifecycle = new URLSearchParams(location.search).get("lifecycle");
const appKeys = [storageKey("likes"), storageKey("lab"), storageKey("comments")];

test("답글 목록을 접고 펼칠 수 있으며 새로고침하면 댓글과 Patch 상태가 복원된다", async () => {
  for (const key of appKeys) localStorage.removeItem(key);
  const frame = await loadDemo();
  try {
    const $ = selector => frame.contentDocument.querySelector(selector);
    $("#like-button").click();
    $("#like-button").click();
    $("#toggle-composer").click();
    input($("#comment-draft"), "등록한 댓글");
    $("#comment-form button").click();
    $("#comment-list .comment-like").click();
    $("#comment-list .comment-like").click();
    const commentTime = $("#comment-list time").dateTime;
    equal($("#comment-list .replies-toggle"), null);
    $("#comment-list .reply-toggle").click();
    const replyForm = $("#reply-form-0");
    input(replyForm.querySelector("textarea"), " \t\n ");
    equal(replyForm.querySelector("button").disabled, true);
    replyForm.requestSubmit();
    equal($("#comment-list .reply-text"), null);
    input(replyForm.querySelector("textarea"), "등록한 대댓글");
    replyForm.querySelector("button").click();
    const replyTime = $("#comment-list .comment-replies time").dateTime;
    assert(Number.isFinite(Date.parse(replyTime)));
    const repliesToggle = $("#comment-list .replies-toggle");
    const replies = $("#comment-replies-0");
    equal(repliesToggle.textContent, "답글 접기 ↑");
    repliesToggle.click();
    equal(repliesToggle.textContent, "답글 펼치기 ↓");
    equal(repliesToggle.getAttribute("aria-expanded"), "false");
    equal(frame.contentWindow.getComputedStyle(replies).display, "none");
    repliesToggle.click();
    equal(replies.hidden, false);
    equal(repliesToggle.getAttribute("aria-expanded"), "true");
    repliesToggle.click();
    input($("#comment-draft"), "작성 중인 댓글");
    const initial = $("#markup").value;
    input($("#markup"), initial.replace("이번 주 학습", "Patch A"));
    $("#apply-patch").click();
    input($("#markup"), initial.replace("이번 주 학습", "Patch B"));
    $("#apply-patch").click();
    $("#history-back").click();
    const draft = initial.replace("이번 주 학습", "미적용 초안");
    input($("#markup"), draft);

    await reloadDemo(frame);
    equal($("#like-button").textContent, "좋아요 2");
    equal($("#comment-list .comment-text").textContent, "등록한 댓글");
    equal($("#comment-list .comment-like").textContent, "좋아요 2");
    equal($("#comment-list .badge"), null);
    equal($("#comment-list time").dateTime, commentTime);
    equal($("#comment-replies-0").hidden, true);
    $("#comment-list .replies-toggle").click();
    equal($("#comment-replies-0").hidden, false);
    equal($("#comment-list > li .reply-text").textContent, "등록한 대댓글");
    equal($("#comment-list .comment-replies time").dateTime, replyTime);
    equal($("#comment-draft").value, "작성 중인 댓글");
    equal($("#actual h3").textContent, "Patch A");
    equal($("#preview h3").textContent, "미적용 초안");
    equal($("#markup").value, draft);
    equal($("#history-position").textContent, "2 / 3");
    equal($("#history-forward").disabled, false);
    $("#history-forward").click();
    equal($("#actual h3").textContent, "Patch B");
    equal($("#preview h3").textContent, "Patch B");
  } finally { frame.remove(); }
});

if (lifecycle === "restart") {
  tests.length = 0;
  test("같은 주소에서 서버만 재시작하면 이전 기록을 무시하고 초기 화면으로 돌아간다", async () => {
    const previousLikes = JSON.parse(localStorage.getItem(storageKey("likes")));
    const previousLab = JSON.parse(localStorage.getItem(storageKey("lab")));
    const previousDiscussion = JSON.parse(localStorage.getItem(storageKey("comments")));
    equal(previousLikes.value, 2);
    equal(previousLab.value.cursor, 2);
    equal(previousDiscussion.value.comments[0].text, "등록한 댓글");
    equal(previousDiscussion.value.comments[0].likes, 2);
    equal(previousDiscussion.value.comments[0].replies[0].text, "등록한 대댓글");
    equal(previousDiscussion.value.draft, "작성 중인 댓글");
    const frame = await loadDemo();
    try {
      const $ = selector => frame.contentDocument.querySelector(selector);
      assert($('meta[name="mini-react-run"]').content !== previousLikes.runId, "server run did not change");
      equal($("#like-button").textContent, "좋아요 0");
      equal($("#comment-list"), null);
      equal($("#comment-summary").textContent, "댓글 0개 · 총 0자");
      equal($("#comment-draft"), null);
      $("#toggle-composer").click();
      equal($("#comment-draft").value, "");
      equal($("#actual h3").textContent, "이번 주 학습");
      equal($("#preview h3").textContent, "이번 주 학습");
      assert($("#markup").value.includes("이번 주 학습"));
      equal($("#history-position").textContent, "1 / 1");
      equal($("#history-back").disabled, true);
      equal($("#history-forward").disabled, true);
    } finally { frame.remove(); }
  });
}

// Manual use of the test page leaves the reader's existing demo data intact.
const backup = lifecycle === null ? appKeys.map(key => [key, localStorage.getItem(key)]) : [];
if (lifecycle !== "restart") for (const key of appKeys) localStorage.removeItem(key);
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
for (const [key, value] of backup) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}
document.documentElement.dataset.tests = failures ? "failed" : "passed";
document.querySelector("#result").textContent = `${tests.length - failures}/${tests.length} 통과`;
