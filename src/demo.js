import { FunctionComponent, h, useEffect, useMemo, useState } from "./component.js";

function LikeBar({ likes, onLike, onToggle, open }) {
  return h("div", { class: "post-actions" },
    h("button", { type: "button", class: "button primary", id: "like-button", onClick: onLike }, "좋아요 ", likes),
    h("button", { type: "button", class: "button", id: "toggle-composer", "aria-expanded": String(open), onClick: onToggle },
      open ? "작성창 닫기" : "댓글 작성"),
    likes >= 10 && h("span", { id: "popular-badge", class: "badge" }, "인기 게시물"),
  );
}

function CommentComposer({ draft, onInput, onSubmit }) {
  return h("form", { id: "comment-form", class: "composer", onSubmit },
    h("label", { for: "comment-draft" }, "댓글 내용"),
    h("textarea", { id: "comment-draft", rows: 3, value: draft, onInput, placeholder: "댓글을 입력하세요." }),
    h("button", { type: "submit", class: "button primary", disabled: !draft.trim() }, "등록"),
  );
}

function CommentList({ comments, summary }) {
  return h("section", { class: "comment-list", "aria-label": "댓글 목록" },
    h("p", { id: "comment-summary", class: "eyebrow" }, `댓글 ${summary.count}개 · 총 ${summary.characters}자`),
    comments.length > 0
      ? h("ul", { id: "comment-list" }, comments.map(comment => h("li", {}, comment)))
      : h("p", { class: "muted" }, "아직 댓글이 없습니다."),
  );
}

function Board() {
  const [likes, setLikes] = useState(9);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState([]);

  const summary = useMemo(() => ({
    count: comments.length,
    characters: comments.reduce((total, item) => total + Array.from(item).length, 0),
  }), [comments]);

  const actions = useMemo(() => ({
    like: () => setLikes(value => value + 1),
    toggle: () => setOpen(value => !value),
    edit: event => setDraft(event.currentTarget.value),
  }), [setLikes, setOpen, setDraft]);

  function submit(event) {
    event.preventDefault();
    const comment = draft.trim();
    if (!comment) return;
    setComments(items => [...items, comment]);
    setDraft("");
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `미니 React | 좋아요 ${likes}`;
    return () => { document.title = previousTitle; };
  }, [likes]);

  return h("article", { class: "post" },
    h("p", { class: "eyebrow" }, "MINI BOARD / 01"),
    h("h3", { id: "post-title" }, "클릭 한 번, 화면 한 조각"),
    h("p", { class: "muted" }, "좋아요가 10이 되면 인기 배지가 나타납니다. 작성창을 닫아도 루트에 저장된 초안은 남습니다."),
    h(LikeBar, { likes, onLike: actions.like, onToggle: actions.toggle, open }),
    h("div", { class: "composer-slot" }, open && h(CommentComposer, { draft, onInput: actions.edit, onSubmit: submit })),
    h(CommentList, { comments, summary }),
  );
}

export function mountBoard(container) {
  const board = new FunctionComponent(Board, container);
  board.mount();
  return board;
}
