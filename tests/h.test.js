// @vitest-environment jsdom
import { expect, it } from "vitest";
import { h } from "../src/h.js";
import { createDOM } from "../src/vdom.js";

it("converts JSX-style arguments to the existing VDOM and renders through createDOM", () => {
  const vnode = h("h3", { className: "title" }, "할 일 목록");
  expect(vnode).toEqual({
    type: "element", tag: "h3", key: null, attributes: { class: "title" },
    children: [{ type: "text", value: "할 일 목록" }],
  });
  expect(createDOM(vnode).outerHTML).toBe('<h3 class="title">할 일 목록</h3>');
});

it("handles null props, keys and child nodes without serializing unsupported events", () => {
  const vnode = h("div", { key: 1 }, h("span", null, "항목 ", 2), null, false);
  expect(createDOM(vnode).outerHTML).toBe('<div data-key="1"><span>항목 2</span></div>');
  expect(() => h("button", { onClick() {} }, "추가")).toThrow("이벤트 연결");
  expect(() => h(() => null, null)).toThrow("문자열 HTML 태그");
});
