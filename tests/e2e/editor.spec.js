import { test, expect } from "@playwright/test";

const title = "#editor [data-key='title']";
const actualTitle = "#actual [data-key='title']";
async function replaceText(page, selector, text) {
  await page.locator(selector).click();
  await page.evaluate(({ selector, text }) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, text);
  }, { selector, text });
}
async function add(page, tag, text) {
  await page.locator("#new-tag").selectOption(tag);
  await page.locator("#new-text").fill(text);
  await page.locator("#add").click();
}
async function attribute(page, name, value) {
  await page.locator("#attribute-name").selectOption(name);
  await page.locator("#attribute-value").fill(value);
  await page.locator("#set-attribute").click();
}
async function apply(page) {
  await page.locator("#patch-button").click();
  await expect(page.locator("#dirty")).toHaveText("적용 완료");
  await expect(page.locator("#patch-status")).not.toHaveAttribute("data-error", "");
}
test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("direct editing applies on Patch and preserves unchanged DOM", async ({ page }) => {
  await page.evaluate(() => {
    window.savedTitle = document.querySelector("#actual [data-key='title']");
    window.savedInput = document.querySelector("#actual [data-key='memo']");
  });
  await replaceText(page, title, "바뀐 제목");
  await expect(page.locator(actualTitle)).toHaveText("오늘의 샘플");
  await expect(page.locator("#changes")).toContainText('"TEXT"');
  await apply(page);
  await expect(page.locator(actualTitle)).toHaveText("바뀐 제목");
  expect(await page.evaluate(() => window.savedTitle === document.querySelector("#actual [data-key='title']") && window.savedInput === document.querySelector("#actual [data-key='memo']"))).toBe(true);
  await apply(page);
  await expect(page.locator("#history-position")).toHaveText("히스토리 2 / 2");
});

test("add, nested select, attributes, move and delete use stable keys", async ({ page }) => {
  await page.locator(title).click();
  await add(page, "p", "추가 문단");
  const key = await page.locator("#key-value").inputValue();
  await expect(page.locator(title).locator("xpath=following-sibling::*[1]")).toHaveAttribute("data-key", key);
  await attribute(page, "class", "added");
  await apply(page);
  await expect(page.locator(`#actual [data-key='${key}']`)).toHaveClass("added");
  await page.evaluate((key) => { window.savedNode = document.querySelector(`#actual [data-key='${key}']`); }, key);
  await page.locator("#move-up").click();
  await apply(page);
  expect(await page.evaluate((key) => window.savedNode === document.querySelector(`#actual [data-key='${key}']`), key)).toBe(true);
  await expect(page.locator("#actual > div > :first-child")).toHaveAttribute("data-key", key);
  await page.locator("#remove-attribute").click();
  await apply(page);
  await expect(page.locator(`#actual [data-key='${key}']`)).not.toHaveAttribute("class");
  await page.locator("#delete").click();
  await apply(page);
  await expect(page.locator(`#actual [data-key='${key}']`)).toHaveCount(0);
  await page.locator("#editor strong").click();
  await page.locator("#select-parent").click();
  await expect(page.locator("#selection")).toContainText("p ·");
  await add(page, "div", "같은 부모에 추가");
  await expect(page.locator("#editor > div > div")).toHaveText("같은 부모에 추가");
});

test("duplicate keys block Patch and can be repaired", async ({ page }) => {
  await page.locator(title).click();
  await add(page, "h3", "중복 제목");
  await page.locator("#key-value").fill("title");
  await page.locator("#set-key").click();
  await expect(page.locator("#key-errors")).toContainText("중복 key: title");
  await expect(page.locator("#patch-button")).toBeDisabled();
  await expect(page.locator(actualTitle)).toHaveCount(1);
  expect(await page.locator("#editor h3").last().evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("dashed");
  await page.locator("#renew-key").click();
  await expect(page.locator("#key-errors")).toBeEmpty();
  await apply(page);
  await expect(page.locator("#actual h3")).toHaveCount(2);
});

test("history restores both panes, cancels dirty navigation and truncates future", async ({ page }) => {
  await expect(page.locator("#dirty")).toHaveText("적용 완료");
  await expect(page.locator("#back")).toBeDisabled();
  await expect(page.locator("#forward")).toBeDisabled();
  await replaceText(page, title, "두 번째 상태");
  await apply(page);
  await replaceText(page, title, "저장하지 않은 내용");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#back").click();
  await expect(page.locator(title)).toHaveText("저장하지 않은 내용");
  await expect(page.locator(actualTitle)).toHaveText("두 번째 상태");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#back").click();
  await expect(page.locator(title)).toHaveText("오늘의 샘플");
  await expect(page.locator(actualTitle)).toHaveText("오늘의 샘플");
  await page.locator("#forward").click();
  await expect(page.locator(title)).toHaveText("두 번째 상태");
  await page.locator("#back").click();
  await replaceText(page, title, "새 갈래");
  await apply(page);
  await expect(page.locator("#forward")).toBeDisabled();
  await expect(page.locator("#history-position")).toHaveText("히스토리 2 / 2");
});

test("input values and checkbox states survive Patch and history", async ({ page }) => {
  await page.locator("#editor [data-key='memo']").fill("바뀐 입력값");
  await page.locator("#editor [data-key='done']").uncheck();
  await apply(page);
  await expect(page.locator("#actual [data-key='memo']")).toHaveValue("바뀐 입력값");
  await expect(page.locator("#actual [data-key='done']")).not.toBeChecked();
  await page.locator("#back").click();
  for (const pane of ["editor", "actual"]) {
    await expect(page.locator(`#${pane} [data-key='memo']`)).toHaveValue("유지할 입력값");
    await expect(page.locator(`#${pane} [data-key='done']`)).toBeChecked();
  }
  await page.locator("#editor [data-key='memo']").click();
  await attribute(page, "value", "도구로 변경");
  await apply(page);
  await expect(page.locator("#actual [data-key='memo']")).toHaveValue("도구로 변경");
});

test("root append, textarea editing and empty title", async ({ page }) => {
  await page.locator("#clear-selection").click();
  await add(page, "textarea", "초기 텍스트");
  const key = await page.locator("#key-value").inputValue();
  await page.locator(`#editor textarea[data-key='${key}']`).fill("수정한 텍스트");
  await apply(page);
  await expect(page.locator(`#actual textarea[data-key='${key}']`)).toHaveValue("수정한 텍스트");
  await replaceText(page, title, "");
  await apply(page);
  await expect(page.locator(actualTitle)).toBeEmpty();
});

test("native select-all delete keeps a usable root and undo history", async ({ page }) => {
  await page.locator(title).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await apply(page);
  await expect(page.locator("#actual")).toHaveText("");
  await page.locator("#back").click();
  await expect(page.locator(title)).toHaveText("오늘의 샘플");
  await page.locator("#clear-selection").click();
  await add(page, "p", "복원 후 추가");
  await apply(page);
  await expect(page.locator("#actual")).toContainText("복원 후 추가");
});

test("a user id cannot replace toolbar controls and disabled elements remain selectable", async ({ page }) => {
  await page.locator(title).click();
  await attribute(page, "id", "key-value");
  await page.locator(".tools #key-value").fill("renamed-title");
  await page.locator("#set-key").click();
  await apply(page);
  await expect(page.locator("#actual [data-key='renamed-title']")).toHaveText("오늘의 샘플");
  await page.locator("#clear-selection").click();
  await add(page, "input", "비활성 입력");
  const key = await page.locator(".tools #key-value").inputValue();
  await attribute(page, "disabled", "");
  await apply(page);
  await page.locator("#clear-selection").click();
  const option = await page.locator("#element-picker option").filter({ hasText: key }).getAttribute("value");
  await page.locator("#element-picker").selectOption(option);
  await page.locator("#remove-attribute").click();
  await apply(page);
  await expect(page.locator(`#actual [data-key='${key}']`)).toBeEnabled();
});

test("lost wrapper is repaired and plain text paste cannot introduce markup", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    editor.replaceChildren(document.createTextNode("완전히 새 내용"));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await apply(page);
  await expect(page.locator("#actual > [data-key='root']")).toHaveText("완전히 새 내용");
  await page.locator("#back").click();
  await page.locator(title).click();
  await page.evaluate(() => {
    const element = document.querySelector("#editor h3");
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "<img src=x onerror=alert(1)>");
    clipboardData.setData("text/html", "<img src=x onerror=alert(1)>");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await apply(page);
  await expect(page.locator("#actual img")).toHaveCount(0);
  await expect(page.locator(actualTitle)).toHaveText("<img src=x onerror=alert(1)>");
});

test("keyed input moves preserve identity, focus and selection; nested list moves preserve nodes", async ({ page }) => {
  await page.locator("#editor [data-key='memo']").click();
  await page.locator("#move-up").click();
  await page.evaluate(() => {
    const input = document.querySelector("#actual [data-key='memo']");
    window.savedInput = input;
    input.focus();
    input.setSelectionRange(1, 4);
    // Keep focus in the actual pane while invoking the same Patch handler.
    document.querySelector("#patch-button").click();
  });
  await expect(page.locator("#dirty")).toHaveText("적용 완료");
  expect(await page.evaluate(() => {
    const input = document.querySelector("#actual [data-key='memo']");
    return input === window.savedInput && document.activeElement === input && input.selectionStart === 1 && input.selectionEnd === 4;
  })).toBe(true);
  await page.evaluate(() => { window.savedLi = document.querySelector("#actual li"); });
  await page.locator("#editor li").first().click();
  await page.locator("#move-down").click();
  await apply(page);
  await expect(page.locator("#actual li").first()).toHaveText("두 번째 항목");
  expect(await page.evaluate(() => document.querySelector("#actual li:last-child") === window.savedLi)).toBe(true);
});

test("desktop and narrow layouts keep controls within the viewport", async ({ page }) => {
  await page.screenshot({ path: "/tmp/mini-react-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(title).click();
  await add(page, "p", "모바일 편집");
  await apply(page);
  await expect(page.locator("#actual")).toContainText("모바일 편집");
  await page.screenshot({ path: "/tmp/mini-react-mobile.png", fullPage: true });
});
