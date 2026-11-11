export const SIZE = 5;
export const CELL_COUNT = SIZE * SIZE;

export function affectedCells(index) {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return [];
  const row = Math.floor(index / SIZE);
  const column = index % SIZE;
  return [index, row > 0 && index - SIZE, row < SIZE - 1 && index + SIZE,
    column > 0 && index - 1, column < SIZE - 1 && index + 1].filter(value => value !== false);
}

export function toggle(board, index) {
  const affected = new Set(affectedCells(index));
  return board.map((on, position) => affected.has(position) ? !on : on);
}

export function boardAt(game) {
  let board = Array(CELL_COUNT).fill(false);
  for (const index of game.scramble) board = toggle(board, index);
  for (const index of game.moves.slice(0, game.cursor)) board = toggle(board, index);
  return board;
}

// Start from a solved board and apply legal moves, so every puzzle has a solution.
export function createGame(random = Math.random) {
  const cells = Array.from({ length: CELL_COUNT }, (_, index) => index);
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [cells[index], cells[other]] = [cells[other], cells[index]];
  }
  const game = { version: 1, scramble: cells.slice(0, 5), moves: [], cursor: 0 };
  if (!boardAt(game).some(Boolean)) game.scramble = [12];
  return game;
}

export function play(game, index) {
  if (affectedCells(index).length === 0 || !boardAt(game).some(Boolean)) return game;
  const moves = [...game.moves.slice(0, game.cursor), index];
  return { ...game, moves, cursor: moves.length };
}

export function travel(game, direction) {
  const cursor = game.cursor + direction;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > game.moves.length) return game;
  return { ...game, cursor };
}

export function restart(game) { return { ...game, moves: [], cursor: 0 }; }

export function restoreGame(value) {
  const validIndex = index => Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
  if (value?.version !== 1 || !Array.isArray(value.scramble) || !value.scramble.length
    || value.scramble.length > CELL_COUNT || !value.scramble.every(validIndex)
    || !Array.isArray(value.moves) || !value.moves.every(validIndex)
    || !Number.isInteger(value.cursor) || value.cursor < 0 || value.cursor > value.moves.length) return null;
  const game = { version: 1, scramble: [...value.scramble], moves: [...value.moves], cursor: value.cursor };
  let board = boardAt(restart(game));
  if (!board.some(Boolean)) return null;
  for (const index of game.moves) {
    if (!board.some(Boolean)) return null;
    board = toggle(board, index);
  }
  return game;
}
