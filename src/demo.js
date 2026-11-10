import { FunctionComponent, h, useEffect, useMemo, useState } from "./component.js";

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function storedTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function CommentTime({ createdAt }) {
  return createdAt
    ? h("time", { class: "comment-time", datetime: createdAt }, timeFormat.format(new Date(createdAt)))
    : h("span", { class: "comment-time" }, "시간 미기록");
}

function updateComment(state, index, change) {
  return { ...state, comments: state.comments.map((comment, position) => position === index ? change(comment) : comment) };
}

function LikeBar({ likes, onLike, onToggle, open }) {
  return h("div", { class: "post-actions" },
    h("button", { type: "button", class: "button primary", id: "like-button", onClick: onLike }, "좋아요 ", likes),
    h("button", { type: "button", class: "button", id: "toggle-composer", "aria-expanded": String(open), onClick: onToggle },
      open ? "작성창 닫기" : "댓글 작성"),
    likes >= 10 && h("span", { id: "popular-badge", class: "badge" }, "인기 게시물"),
  );
}

function CommentComposer({ draft, onInput, onSubmit, replyIndex }) {
  const replying = replyIndex !== undefined;
  const draftId = replying ? `reply-draft-${replyIndex}` : "comment-draft";
  return h("form", { id: replying ? `reply-form-${replyIndex}` : "comment-form", class: "composer", onSubmit },
    h("label", { for: draftId }, replying ? "대댓글 내용" : "댓글 내용"),
    h("textarea", { id: draftId, rows: 3, value: draft, onInput, placeholder: replying ? "대댓글을 입력하세요." : "댓글을 입력하세요." }),
    h("button", { type: "submit", class: "button primary", disabled: !draft.trim() }, replying ? "대댓글 등록" : "등록"),
  );
}

function CommentRow({ comment, popular, replyOpen, onReplyInput, onReplySubmit }) {
  const repliesId = `comment-replies-${comment.index}`;
  return h("li", { class: "comment-row" },
    h("div", { class: "comment-line" },
      h("span", { class: "comment-text" }, comment.text),
      h("div", { class: "comment-actions" },
        popular && h("span", { class: "badge" }, "인기 댓글"),
        comment.replies.length > 0 && h("button", {
          type: "button", class: "button replies-toggle", "data-replies-index": comment.index,
          "aria-controls": repliesId, "aria-expanded": String(!comment.repliesCollapsed),
        }, comment.repliesCollapsed ? "답글 펼치기" : "답글 접기", " ",
          h("span", { "aria-hidden": "true" }, comment.repliesCollapsed ? "↓" : "↑")),
        h("span", { class: "comment-controls" },
          h(CommentTime, { createdAt: comment.createdAt }),
          h("button", {
            type: "button", class: "button reply-toggle", "data-reply-index": comment.index,
            "aria-expanded": String(replyOpen),
          }, replyOpen ? "답글 닫기" : "답글"),
          h("button", {
            type: "button", class: "button comment-like", "data-comment-index": comment.index,
            "aria-label": `댓글 ${comment.index + 1} 좋아요 ${comment.likes}`,
          }, "좋아요 ", comment.likes),
        ),
      ),
    ),
    comment.replies.length > 0 && h("ul", {
      id: repliesId, class: "comment-replies", "aria-label": "대댓글", hidden: comment.repliesCollapsed,
    },
      comment.replies.map(reply => h("li", { class: "reply-row" },
        h("span", { class: "reply-text" }, reply.text), h(CommentTime, { createdAt: reply.createdAt }),
      )),
    ),
    replyOpen && h("div", { class: "reply-composer" }, h(CommentComposer, {
      replyIndex: comment.index, draft: comment.replyDraft,
      onInput: event => onReplyInput(comment.index, event.currentTarget.value),
      onSubmit: event => onReplySubmit(event, comment.index, comment.replyDraft),
    })),
  );
}

function CommentList({ comments, summary, replyTo, onClick, onReplyInput, onReplySubmit }) {
  return h("section", { class: "comment-list", "aria-label": "댓글 목록" },
    h("p", { id: "comment-summary", class: "eyebrow" }, `댓글 ${summary.count}개 · 총 ${summary.characters}자`),
    comments.length > 0
      ? h("ul", { id: "comment-list", onClick }, comments.map((comment, rank) => h(CommentRow, {
        comment, popular: rank === 0 && comment.likes >= 10,
        replyOpen: replyTo === comment.index, onReplyInput, onReplySubmit,
      })))
      : h("p", { class: "muted" }, "아직 댓글이 없습니다."),
  );
}

function Board({ storage }) {
  const [likes, setLikes] = useState(() => {
    const saved = storage?.read("likes");
    return Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
  });
  const [discussion, setDiscussion] = useState(() => {
    const saved = storage?.read("comments");
    const comments = Array.isArray(saved?.comments) ? saved.comments.flatMap(item => {
      const record = typeof item === "string" ? { text: item } : item;
      if (typeof record?.text !== "string") return [];
      return [{
        text: record.text,
        likes: Number.isSafeInteger(record.likes) && record.likes >= 0 ? record.likes : 0,
        createdAt: storedTime(record.createdAt),
        replies: Array.isArray(record.replies) ? record.replies.filter(reply => typeof reply?.text === "string")
          .map(reply => ({ text: reply.text, createdAt: storedTime(reply.createdAt) })) : [],
        repliesCollapsed: record.repliesCollapsed === true,
        replyDraft: typeof record.replyDraft === "string" ? record.replyDraft : "",
      }];
    }) : [];
    return {
      open: saved?.open === true,
      draft: typeof saved?.draft === "string" ? saved.draft : "",
      comments,
      replyTo: Number.isInteger(saved?.replyTo) && comments[saved.replyTo] ? saved.replyTo : null,
    };
  });
  const { open, draft, comments, replyTo } = discussion;

  const summary = useMemo(() => ({
    count: comments.length,
    characters: comments.reduce((total, item) => total + Array.from(item.text).length, 0),
  }), [comments]);

  // Keep state in registration order. Sort a display copy, with older comments first on ties.
  const rankedComments = useMemo(() => comments.map((comment, index) => ({ ...comment, index }))
    .sort((a, b) => b.likes - a.likes || a.index - b.index), [comments]);

  const actions = useMemo(() => ({
    like: () => setLikes(value => value + 1),
    clickComment(event) {
      const button = event.target.closest?.("button[data-comment-index], button[data-reply-index], button[data-replies-index]");
      if (!button) return;
      if (button.dataset.repliesIndex !== undefined) {
        const index = Number(button.dataset.repliesIndex);
        setDiscussion(state => updateComment(state, index, comment => ({ ...comment, repliesCollapsed: !comment.repliesCollapsed })));
        return;
      }
      if (button.dataset.replyIndex !== undefined) {
        const index = Number(button.dataset.replyIndex);
        setDiscussion(state => ({ ...state, replyTo: state.replyTo === index ? null : index }));
        return;
      }
      const index = Number(button.dataset.commentIndex);
      const list = event.currentTarget;
      const restoreFocus = list.ownerDocument.activeElement === button;
      setDiscussion(state => updateComment(state, index, comment => ({ ...comment, likes: comment.likes + 1 })));
      if (restoreFocus) list.querySelector(`button[data-comment-index="${index}"]`)?.focus({ preventScroll: true });
    },
    editReply: (index, value) => setDiscussion(state => updateComment(state, index, comment => ({ ...comment, replyDraft: value }))),
    toggle: () => setDiscussion(state => ({ ...state, open: !state.open })),
    edit: event => setDiscussion(state => ({ ...state, draft: event.currentTarget.value })),
  }), [setLikes, setDiscussion]);

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const comment = { text, likes: 0, createdAt: new Date().toISOString(), replies: [], repliesCollapsed: false, replyDraft: "" };
    setDiscussion(state => ({ ...state, comments: [...state.comments, comment], draft: "" }));
  }

  function submitReply(event, index, draft) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const reply = { text, createdAt: new Date().toISOString() };
    setDiscussion(state => ({
      ...updateComment(state, index, comment => ({
        ...comment, replies: [...comment.replies, reply], repliesCollapsed: false, replyDraft: "",
      })),
      replyTo: null,
    }));
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `미니 React | 좋아요 ${likes}`;
    storage?.write("likes", likes);
    return () => { document.title = previousTitle; };
  }, [likes, storage]);

  useEffect(() => {
    storage?.write("comments", discussion);
  }, [discussion, storage]);

  return h("article", { class: "post" },
    h("p", { class: "eyebrow" }, "MINI BOARD / 01"),
    h("h3", { id: "post-title" }, "클릭 한 번, 화면 한 조각"),
    h("p", { class: "muted" }, "좋아요가 10이 되면 인기 배지가 나타납니다. 작성창을 닫아도 루트에 저장된 초안은 남습니다."),
    h(LikeBar, { likes, onLike: actions.like, onToggle: actions.toggle, open }),
    h("div", { class: "composer-slot" }, open && h(CommentComposer, { draft, onInput: actions.edit, onSubmit: submit })),
    h(CommentList, {
      comments: rankedComments, summary, replyTo, onClick: actions.clickComment,
      onReplyInput: actions.editReply, onReplySubmit: submitReply,
    }),
  );
}

export function mountBoard(container, storage) {
  const board = new FunctionComponent(Board, container, { storage });
  board.mount();
  return board;
}
