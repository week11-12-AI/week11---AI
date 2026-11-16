import { FunctionComponent, h, useEffect, useMemo, useState } from "./component.js";
import { SIZE, affectedCells, boardAt, createGame, play, restart, restoreGame, travel } from "./puzzle.js";
import { CHALLENGE, createChallenge } from "./challenge.js";
import { changeTimer, elapsedAt, formatSeconds } from "./timer.js";

function LightGrid({ board, preview, solved, actions, busy }) {
  return h("div", {
    id: "light-grid", class: "light-grid", role: "group", "aria-label": "5행 5열 불 끄기 퍼즐",
    onClick: actions.click, onPointerOver: actions.hover, onPointerLeave: actions.leave,
    onFocusIn: actions.hover, onFocusOut: actions.leave, onKeyDown: actions.keydown,
  }, board.map((on, index) => h("button", {
    type: "button", class: `light${on ? " is-on" : ""}${!solved && preview.includes(index) ? " is-preview" : ""}`,
    "data-cell": index, "aria-pressed": String(on), "aria-disabled": String(solved || busy), disabled: busy,
    "aria-label": `${Math.floor(index / SIZE) + 1}행 ${index % SIZE + 1}열, ${on ? "켜짐" : "꺼짐"}`,
  }, h("span", { class: "light-core", "aria-hidden": "true" }),
  h("span", { class: "light-position", "aria-hidden": "true" }, `${Math.floor(index / SIZE) + 1}.${index % SIZE + 1}`))));
}

function GameControls({ game, solved, actions, busy = false, lockHistory = false }) {
  return h("div", { class: "game-controls" },
    h("div", { class: "history-buttons" },
      h("button", { id: "undo", type: "button", class: "button", disabled: busy || lockHistory || game.cursor === 0, onClick: actions.undo }, "↶ 되돌리기"),
      h("button", { id: "redo", type: "button", class: "button", disabled: busy || lockHistory || game.cursor === game.moves.length, onClick: actions.redo }, "↷ 다시 실행")),
    h("button", { id: "restart", type: "button", class: "button restart-button", disabled: busy || game.moves.length === 0, onClick: actions.restart }, "이 퍼즐 처음부터"),
    h("button", { id: "new-game", type: "button", class: "button primary", disabled: busy, onClick: actions.newGame }, solved ? "다음 퍼즐 시작하기 →" : "새 퍼즐 시작하기 →"));
}

function RankingPanel({ ranking, reload }) {
  return h("section", { class: "ranking-panel", "aria-labelledby": "ranking-title" },
    h("div", { class: "panel-head" },
      h("div", {}, h("p", { class: "eyebrow" }, "CHALLENGE LEADERBOARD"), h("h2", { id: "ranking-title" }, "공통 도전 · TOP 10")),
      h("button", { id: "refresh-ranking", class: "button compact", type: "button", disabled: ranking.loading, onClick: reload }, ranking.loading ? "불러오는 중…" : "랭킹 새로고침")),
    h("p", { class: "helper" }, "랜덤 배치의 성공 기록이에요. 이동 횟수가 같으면 더 빨리 푼 기록이 앞서요."),
    h("p", { class: ranking.error ? "api-error" : "save-note", role: "status", "aria-live": "polite" },
      ranking.error || (ranking.loading ? "기록을 불러오고 있어요." : ranking.rows.length ? "서버를 다시 시작해도 기록은 유지돼요." : "아직 기록이 없어요. 첫 번째 성공 기록을 남겨보세요.")),
    h("ol", { class: "ranking-list", id: "ranking-list" }, ranking.rows.map((row, index) =>
      h("li", { "data-record-id": row.id }, h("span", { class: "rank-number" }, String(index + 1).padStart(2, "0")),
        h("strong", { class: "rank-name" }, row.nickname),
        h("span", { class: "rank-result" }, h("span", { class: "rank-moves" }, `${row.moves}회`),
          h("span", { class: "rank-time" }, row.elapsed_ms == null ? "시간 미측정" : formatSeconds(row.elapsed_ms)))))));
}

function RecordForm({ nickname, changeName, submit, submission, solved, ranked, saved, verification, retry }) {
  return h("form", { id: "record-form", class: "record-form", onSubmit: submit },
    h("label", { for: "record-nickname" }, "랭킹에 남길 닉네임"),
    h("div", { class: "record-fields" },
      h("input", { id: "record-nickname", name: "nickname", value: nickname, maxlength: 20, placeholder: "1~20자", autocomplete: "nickname", disabled: submission.busy, onInput: changeName }),
      h("button", { id: "save-record", class: "button primary", type: "submit", disabled: !ranked || !solved || verification.status !== "done" || submission.busy || saved || !nickname.trim() }, submission.busy ? "저장 중…" : saved ? "저장 완료" : "성공 기록 저장")),
    h("p", { id: "record-status", class: submission.error ? "api-error" : "save-note", role: "status", "aria-live": "polite" },
      submission.error || (saved ? "기록을 저장했어요. 아래 랭킹에서 확인하세요." : !ranked ? "공통 도전에 참여하면 랭킹을 등록할 수 있어요." : !solved ? "모든 불을 끄면 성공 기록을 저장할 수 있어요." : verification.status === "done" ? "시간 측정이 끝났어요. 닉네임을 입력하고 기록을 남겨보세요." : "성공 기록을 확인하고 있어요.")),
    verification.error ? h("div", { class: "api-error", role: "alert" }, verification.error,
      h("button", { id: "retry-finish", type: "button", class: "button compact", onClick: retry }, "성공 확인 재시도")) : null);
}

function Puzzle({ storage, api }) {
  const [game, setGame] = useState(() => restoreGame(storage?.read("puzzle")) ?? createGame());
  const [hovered, setHovered] = useState(null);
  const [nickname, setNickname] = useState("");
  const [ranking, setRanking] = useState({ rows: [], loading: Boolean(api), error: "" });
  const [refresh, setRefresh] = useState(0);
  const [submission, setSubmission] = useState({ busy: false, error: "", saved: "" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [verification, setVerification] = useState({ status: "idle", error: "" });
  const [finishRetry, setFinishRetry] = useState(0);
  const [, setClock] = useState(0);
  const board = useMemo(() => boardAt(game), [game]);
  const remaining = useMemo(() => board.filter(Boolean).length, [board]);
  const preview = useMemo(() => affectedCells(hovered), [hovered]);
  const solved = remaining === 0;
  const ranked = game.puzzleId === CHALLENGE.id && Boolean(game.attemptId);
  const saved = Boolean(game.recordId);
  const elapsedMs = elapsedAt(game.timer);
  const busy = starting || submission.busy;
  const requests = useMemo(() => ({ active: true, generation: 0 }), []);

  function timedUpdate(current, next) {
    if (next === current) return current;
    return { ...next, timer: changeTimer(current.timer, boardAt(next).some(Boolean)) };
  }

  async function startChallenge(sameBoard = false) {
    if (!api || busy) return;
    const generation = ++requests.generation;
    setStarting(true);
    setStartError("");
    try {
      const attempt = await api.start(sameBoard ? game.attemptId : undefined);
      if (!requests.active || generation !== requests.generation) return;
      setGame(createChallenge(attempt));
      setHovered(null);
      setSubmission({ busy: false, error: "", saved: "" });
    } catch (error) {
      if (requests.active && generation === requests.generation) setStartError(error.message || "도전을 시작하지 못했어요.");
    } finally {
      if (requests.active && generation === requests.generation) setStarting(false);
    }
  }
  const actions = useMemo(() => ({
    click(event) {
      const cell = event.target.closest?.("button[data-cell]");
      if (cell && !busy) setGame(current => timedUpdate(current, play(current, Number(cell.dataset.cell))));
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
    undo() { if (!busy && !(ranked && solved)) setGame(current => timedUpdate(current, travel(current, -1))); },
    redo() { if (!busy && !(ranked && solved)) setGame(current => timedUpdate(current, travel(current, 1))); },
    restart() {
      if (ranked) { void startChallenge(true); return; }
      setGame(current => ({ ...restart(current), timer: { elapsedMs: 0, startedAt: null } }));
      setSubmission({ busy: false, error: "", saved: "" });
    },
    newGame() { requests.generation += 1; setGame(createGame()); setHovered(null); setStartError(""); setSubmission({ busy: false, error: "", saved: "" }); },
    challenge() { void startChallenge(); },
  }), [setGame, setHovered, ranked, solved, busy, game.attemptId, api]);

  useEffect(() => () => { requests.active = false; requests.generation += 1; }, [requests]);
  useEffect(() => {
    if (game.timer?.startedAt == null) return;
    const interval = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(interval);
  }, [game.timer?.startedAt]);

  useEffect(() => {
    if (!api || !ranked || !solved) { setVerification({ status: "idle", error: "" }); return; }
    let active = true;
    setVerification({ status: "checking", error: "" });
    api.finish({ attemptId: game.attemptId, moves: game.moves.slice(0, game.cursor) }).then(result => {
      if (!active) return;
      setGame(current => current.attemptId === game.attemptId ? { ...current, timer: { elapsedMs: result.elapsedMs, startedAt: null } } : current);
      setVerification({ status: "done", error: "" });
    }).catch(error => { if (active) setVerification({ status: "error", error: error.message || "성공 확인에 실패했어요." }); });
    return () => { active = false; };
  }, [api, game.attemptId, ranked, solved, finishRetry]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    setRanking(current => ({ ...current, loading: true, error: "" }));
    api.ranking().then(result => { if (active) setRanking({ rows: result.rows, loading: false, error: "" }); })
      .catch(error => { if (active) setRanking(current => ({ ...current, loading: false, error: error.message || "랭킹을 불러오지 못했어요." })); });
    return () => { active = false; };
  }, [api, refresh]);

  async function submit(event) {
    event.preventDefault();
    if (!api || !ranked || !solved || saved || busy || verification.status !== "done" || !nickname.trim()) return;
    setSubmission({ busy: true, error: "", saved: "" });
    try {
      const result = await api.submit({ puzzleId: CHALLENGE.id, attemptId: game.attemptId, nickname: nickname.trim() });
      setGame(current => current.attemptId === game.attemptId ? { ...current, recordId: result.id } : current);
      setSubmission({ busy: false, error: "", saved: "" });
      setRefresh(value => value + 1);
    } catch (error) { setSubmission({ busy: false, error: error.message || "저장하지 못했어요. 다시 시도하세요.", saved: "" }); }
  }

  useEffect(() => { storage?.write("puzzle", game); }, [game, storage]);
  useEffect(() => {
    const previous = document.title;
    document.title = solved ? "성공! | Lights Out" : `불 ${remaining}개 남음 | Lights Out`;
    return () => { document.title = previous; };
  }, [solved, remaining]);

  return h("div", { class: "game-layout" },
    h("section", { class: `board-panel${solved ? " is-solved" : ""}`, "aria-label": "퍼즐 보드" },
      h("div", { class: "board-heading" }, h("span", { id: "game-mode" }, ranked ? CHALLENGE.title : "THE GRID · 연습"), h("span", {}, "5 × 5")),
      h(LightGrid, { board, preview, solved, actions, busy }),
      h("div", { class: "board-caption" }, h("span", { class: "legend" }, h("i", {}), "켜진 불"), h("span", {}, "모든 불을 끄면 성공"))),
    h("aside", { class: "game-sidebar", "aria-label": "게임 진행" },
      h("p", { class: "eyebrow" }, "YOUR PROGRESS"),
      h("div", { class: "stats" },
        h("div", {}, h("span", { class: "stat-label" }, "남은 불"), h("p", {}, h("strong", { id: "remaining" }, remaining), h("span", { class: "stat-unit" }, " / 25"))),
        h("div", {}, h("span", { class: "stat-label" }, "이동 횟수"), h("p", {}, h("strong", { id: "moves" }, game.cursor), h("span", { class: "stat-unit" }, " 회"))),
        h("div", { class: "time-stat" }, h("span", { class: "stat-label" }, "소요 시간"),
          h("strong", { id: "elapsed-time", role: "timer", "aria-label": "소요 시간" }, formatSeconds(elapsedMs)))),
      h("div", { id: "game-status", class: `game-status${solved ? " success" : ""}`, role: "status", "aria-live": "polite" },
        h("strong", {}, solved ? "모든 불을 껐어요!" : "한 칸을 눌러보세요"),
        h("p", {}, solved ? `${game.cursor}번 만에 성공했어요. 다음 퍼즐도 도전해 볼까요?` : "선택한 칸과 위·아래·왼쪽·오른쪽의 불이 함께 바뀝니다.")),
      h(GameControls, { game, solved, actions, busy, lockHistory: ranked && solved }),
      h("p", { class: "save-note" }, "진행 상황을 자동 저장해요. 같은 서버에서 새로고침해도 이어 할 수 있어요."),
      api ? h("div", { class: "challenge-controls" },
        h("button", { id: "start-challenge", type: "button", class: "button challenge-button", disabled: busy, onClick: actions.challenge }, starting ? "랜덤 배치 준비 중…" : "공통 도전 시작 →"),
        h("p", { class: "save-note" }, "시작할 때마다 새 배치와 시간으로 도전해요. 성공하면 시간이 멈춰요."),
        startError ? h("p", { class: "api-error", role: "alert" }, startError) : null,
        h(RecordForm, { nickname, changeName: event => setNickname(event.target.value), submit, submission, solved, ranked, saved, verification, retry: () => setFinishRetry(value => value + 1) })) : null),
    api ? h(RankingPanel, { ranking, reload: () => setRefresh(value => value + 1) }) : null);
}

export function mountGame(container, storage, api) {
  const root = new FunctionComponent(Puzzle, container, { storage, api });
  root.mount();
  return root;
}
