import { h } from "./h.js";
import { createDOM } from "./vdom.js";

// Vite transforms this JSX into h("h3", { className: "title" }, "할 일 목록").
const vnode = <h3 className="title">할 일 목록</h3>;

// h() creates plain data; createDOM() creates the actual browser node.
document.querySelector("#jsx-vdom").textContent = JSON.stringify(vnode, null, 2);
document.querySelector("#jsx-result").appendChild(createDOM(vnode));
