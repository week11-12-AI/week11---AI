import { FunctionComponent, h, useEffect, useMemo, useState } from "./component.js";
import { SIZE, affectedCells, boardAt, createGame, play, restart, restoreGame, travel } from "./puzzle.js";

function LightGrid({ board, preview, solved, actions }) {
  return h("div", {
    id: "light-grid", class: "light-grid", role: "group", "aria-label": "5행 5열 불 끄기 퍼즐",
    onClick: actions.click, onPointerOver: actions.hover, onPointerLeave: actions.leave,
    onFocusIn: actions.hover, onFocusOut: actions.leave, onKeyDown: actions.keydown,
  }, board.map((on, index) => h("button", {
    type: "button", class: `light${on ? " is-on" : ""}${!solved && preview.includes(index) ? " is-preview" : ""}`,
    "data-cell": index, "aria-pressed": String(on), "aria-disabled": String(solved),
    "aria-label": `${Math.floor(index / SIZE) + 1}행 ${index % SIZE + 1}열, ${on ? "켜짐" : "꺼짐"}`,
  }, h("span", { class: "light-core", "aria-hidden": "true" }),
  h("span", { class: "light-position", "aria-hidden": "true" }, `${Math.floor(index / SIZE) + 1}.${index % SIZE + 1}`))));
}

function GameControls({ game, solved, actions }) {
  return h("div", { class: "game-controls" },
    h("div", { class: "history-buttons" },
      h("button", { id: "undo", type: "button", class: "button", disabled: game.cursor === 0, onClick: actions.undo }, "↶ 되돌리기"),
      h("button", { id: "redo", type: "button", class: "button", disabled: game.cursor === game.moves.length, onClick: actions.redo }, "↷ 다시 실행")),
    h("button", { id: "restart", type: "button", class: "button restart-button", disabled: game.moves.length === 0, onClick: actions.restart }, "이 퍼즐 처음부터"),
    h("button", { id: "new-game", type: "button", class: "button primary", onClick: actions.newGame }, solved ? "다음 퍼즐 시작하기 →" : "새 퍼즐 시작하기 →"));
}

function Puzzle({ storage }) {
  const [game, setGame] = useState(() => restoreGame(storage?.read("puzzle")) ?? createGame());
  const [hovered, setHovered] = useState(null);
  const board = useMemo(() => boardAt(game), [game]);
  const remaining = useMemo(() => board.filter(Boolean).length, [board]);
  const preview = useMemo(() => affectedCells(hovered), [hovered]);
  const solved = remaining === 0;
  const actions = useMemo(() => ({
    click(event) {
      const cell = event.target.closest?.("button[data-cell]");
      if (cell) setGame(current => play(current, Number(cell.dataset.cell)));
    },
    hover(event) {
      const cell = event.target.closest?.("button[data-cell]");
      if (cell) setHovered(Number(cell.dataset.cell));
    },
    leave() { setHovered(null); },
    keydown(event) {
      const cell = event.target.closest?.("button[data-cell]");
      if (!cell || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const index = Number(cell.dataset.cell);
      const row = Math.floor(index / SIZE);
      const column = index % SIZE;
      const nextRow = Math.max(0, Math.min(SIZE - 1, row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0)));
      const nextColumn = Math.max(0, Math.min(SIZE - 1, column + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
      event.currentTarget.querySelector(`[data-cell="${nextRow * SIZE + nextColumn}"]`).focus();
    },
    undo() { setGame(current => travel(current, -1)); },
    redo() { setGame(current => travel(current, 1)); },
    restart() { setGame(current => restart(current)); },
    newGame() { setGame(createGame()); setHovered(null); },
  }), [setGame, setHovered]);

  useEffect(() => { storage?.write("puzzle", game); }, [game, storage]);
  useEffect(() => {
    const previous = document.title;
    document.title = solved ? "성공! | Lights Out" : `불 ${remaining}개 남음 | Lights Out`;
    return () => { document.title = previous; };
  }, [solved, remaining]);

  return h("div", { class: "game-layout" },
    h("section", { class: `board-panel${solved ? " is-solved" : ""}`, "aria-label": "퍼즐 보드" },
      h("div", { class: "board-heading" }, h("span", {}, "THE GRID"), h("span", {}, "5 × 5")),
      h(LightGrid, { board, preview, solved, actions }),
      h("div", { class: "board-caption" }, h("span", { class: "legend" }, h("i", {}), "켜진 불"), h("span", {}, "모든 불을 끄면 성공"))),
    h("aside", { class: "game-sidebar", "aria-label": "게임 진행" },
      h("p", { class: "eyebrow" }, "YOUR PROGRESS"),
      h("div", { class: "stats" },
        h("div", {}, h("span", { class: "stat-label" }, "남은 불"), h("p", {}, h("strong", { id: "remaining" }, remaining), h("span", { class: "stat-unit" }, " / 25"))),
        h("div", {}, h("span", { class: "stat-label" }, "이동 횟수"), h("p", {}, h("strong", { id: "moves" }, game.cursor), h("span", { class: "stat-unit" }, " 회")))),
      h("div", { id: "game-status", class: `game-status${solved ? " success" : ""}`, role: "status", "aria-live": "polite" },
        h("strong", {}, solved ? "모든 불을 껐어요!" : "한 칸을 눌러보세요"),
        h("p", {}, solved ? `${game.cursor}번 만에 성공했어요. 다음 퍼즐도 도전해 볼까요?` : "선택한 칸과 위·아래·왼쪽·오른쪽의 불이 함께 바뀝니다.")),
      h(GameControls, { game, solved, actions }),
      h("p", { class: "save-note" }, "진행 상황을 자동 저장해요. 같은 서버에서 새로고침해도 이어 할 수 있어요.")));
}

export function mountGame(container, storage) {
  const root = new FunctionComponent(Puzzle, container, { storage });
  root.mount();
  return root;
}
