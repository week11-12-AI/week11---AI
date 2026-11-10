/** Build a Phase 1-compatible VDOM node from a JSX-generated function call. */
export function h(tag, props, ...children) {
  if (typeof tag !== "string") {
    throw new TypeError("지금 단계에서는 문자열 HTML 태그만 지원합니다.");
  }

  const attributes = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (name === "key") continue;
    if (/^on/i.test(name)) {
      throw new TypeError("이벤트 연결은 다음 구현 단계입니다.");
    }
    if (value == null || value === false) continue;
    attributes[name === "className" ? "class" : name] = value === true ? "" : String(value);
  }

  return {
    type: "element",
    tag,
    key: props?.key == null ? null : String(props.key),
    attributes,
    children: children.flat(Infinity)
      .filter((child) => child != null && typeof child !== "boolean")
      .map((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return { type: "text", value: String(child) };
        }
        if (child?.type === "element" || child?.type === "text") return child;
        throw new TypeError("자식에는 텍스트·숫자·VDOM을 사용할 수 있습니다.");
      }),
  };
}
