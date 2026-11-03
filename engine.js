/* 2048 Remix — a dependency-free engine, shared by the browser and Node tests. */
(function (root, factory) {
  'use strict';
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.Remix2048 = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODES = Object.freeze({ classic: 4, daily: 4, zen: 5, tiny: 3, sprint: 4, versus: 4, arena: 4 });
  const ASSIST_LIMIT = 3;
  const goalFor = (mode) => mode === 'tiny' ? 512 : 2048;
  const moveLimitFor = (mode) => mode === 'sprint' ? 50 : null;
  const DIRECTIONS = Object.freeze(['left', 'up', 'down', 'right']);
  const cloneBoard = (board) => board.map((row) => row.slice());
  const highest = (board) => Math.max(2, ...board.flat());
  const utcDate = (date = new Date()) => date.toISOString().slice(0, 10);

  function seedFrom(text) {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
    return (seed >>> 0) || 1;
  }

  function randomStep(seed) {
    let next = seed >>> 0 || 1;
    next ^= next << 13;
    next ^= next >>> 17;
    next ^= next << 5;
    return { seed: next >>> 0, value: (next >>> 0) / 4294967296 };
  }

  function emptyCells(board) {
    const cells = [];
    board.forEach((row, r) => row.forEach((value, c) => { if (!value) cells.push({ r, c }); }));
    return cells;
  }

  function spawnTile(board, seed) {
    const copy = cloneBoard(board);
    const empty = emptyCells(copy);
    if (!empty.length) return { board: copy, seed, tile: null };
    const position = randomStep(seed);
    const number = randomStep(position.seed);
    const tile = { ...empty[Math.floor(position.value * empty.length)], value: number.value < 0.9 ? 2 : 4 };
    copy[tile.r][tile.c] = tile.value;
    return { board: copy, seed: number.seed, tile };
  }

  function createGame(mode = 'classic', date = utcDate(), seed = 1) {
    if (!Object.hasOwn(MODES, mode)) throw new Error('Unknown game mode');
    const size = MODES[mode];
    const first = spawnTile(Array.from({ length: size }, () => Array(size).fill(0)), mode === 'daily' ? seedFrom('2048-remix:' + date) : seed);
    const second = spawnTile(first.board, first.seed);
    return { version: 1, mode, size, date: mode === 'daily' ? date : null, board: second.board, rng: second.seed, score: 0, moves: 0, won: false, continued: false, undosUsed: 0, hintsUsed: 0 };
  }

  function coordinate(line, offset, direction, size) {
    if (direction === 'left') return { r: line, c: offset };
    if (direction === 'right') return { r: line, c: size - 1 - offset };
    if (direction === 'up') return { r: offset, c: line };
    return { r: size - 1 - offset, c: line };
  }

  /** Each source tile contributes one motion; a merged pair shares a destination. */
  function moveBoard(board, direction) {
    if (!DIRECTIONS.includes(direction)) throw new Error('Unknown direction');
    const size = board.length;
    const next = Array.from({ length: size }, () => Array(size).fill(0));
    const motions = [];
    const merges = [];
    let gained = 0;
    for (let line = 0; line < size; line++) {
      const entries = [];
      for (let offset = 0; offset < size; offset++) {
        const from = coordinate(line, offset, direction, size);
        if (board[from.r][from.c]) entries.push({ from, value: board[from.r][from.c] });
      }
      let slot = 0;
      for (let i = 0; i < entries.length; i++) {
        const to = coordinate(line, slot++, direction, size);
        const entry = entries[i];
        const pair = entries[i + 1];
        const merge = pair && pair.value === entry.value;
        const value = merge ? entry.value * 2 : entry.value;
        next[to.r][to.c] = value;
        motions.push({ from: entry.from, to, value: entry.value });
        if (merge) {
          motions.push({ from: pair.from, to, value: pair.value });
          merges.push({ ...to, value });
          gained += value;
          i++;
        }
      }
    }
    const changed = motions.some(({ from, to }) => from.r !== to.r || from.c !== to.c) || merges.length > 0;
    return { board: next, motions, merges, gained, changed };
  }

  function canMove(board) {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board.length; c++) {
        const value = board[r][c];
        if (!value || (c + 1 < board.length && value === board[r][c + 1]) || (r + 1 < board.length && value === board[r + 1][c])) return true;
      }
    }
    return false;
  }

  function roundOver(state) {
    const limit = moveLimitFor(state.mode);
    return (limit !== null && state.moves >= limit) || !canMove(state.board);
  }

  function play(state, direction) {
    if (roundOver(state)) return { board: cloneBoard(state.board), motions: [], merges: [], gained: 0, changed: false, state, spawn: null };
    const moved = moveBoard(state.board, direction);
    if (!moved.changed) return { ...moved, state, spawn: null };
    const spawned = spawnTile(moved.board, state.rng);
    const won = state.won || highest(moved.board) >= goalFor(state.mode);
    return { ...moved, spawn: spawned.tile, state: { ...state, board: spawned.board, rng: spawned.seed, score: state.score + moved.gained, moves: state.moves + 1, won, continued: state.continued || (['zen', 'sprint', 'versus', 'arena'].includes(state.mode) && won) } };
  }

  /** Assist usage belongs to the run, so rewinding a board never refunds it. */
  function undoGame(current, previous) {
    if (!previous || current.undosUsed >= ASSIST_LIMIT || previous.mode !== current.mode || previous.date !== current.date) return null;
    return { ...previous, board: cloneBoard(previous.board), undosUsed: current.undosUsed + 1, hintsUsed: current.hintsUsed };
  }

  function useHint(state) {
    if (state.hintsUsed >= ASSIST_LIMIT || roundOver(state) || (state.won && !state.continued)) return null;
    return { ...state, hintsUsed: state.hintsUsed + 1 };
  }

  function evaluate(board) {
    const max = highest(board);
    const size = board.length;
    const corners = [board[0][0], board[0][size - 1], board[size - 1][0], board[size - 1][size - 1]];
    let smooth = 0;
    let monotonic = 0;
    for (let r = 0; r < size; r++) {
      let rowUp = 0, rowDown = 0, colUp = 0, colDown = 0;
      for (let c = 0; c < size - 1; c++) {
        const a = board[r][c] ? Math.log2(board[r][c]) : 0;
        const b = board[r][c + 1] ? Math.log2(board[r][c + 1]) : 0;
        const x = board[c][r] ? Math.log2(board[c][r]) : 0;
        const y = board[c + 1][r] ? Math.log2(board[c + 1][r]) : 0;
        rowUp += Math.max(0, b - a); rowDown += Math.max(0, a - b);
        colUp += Math.max(0, y - x); colDown += Math.max(0, x - y);
        if (a && b) smooth -= Math.abs(a - b);
        if (x && y) smooth -= Math.abs(x - y);
      }
      monotonic -= Math.min(rowUp, rowDown) + Math.min(colUp, colDown);
    }
    return emptyCells(board).length * 240 + smooth * 7 + monotonic * 18 + Math.log2(max) * (corners.includes(max) ? 35 : 8) + (canMove(board) ? 0 : -100000);
  }

  /** A small expectimax nudge; never consumes the real game's random sequence. */
  function hint(board) {
    let best = null, bestValue = -Infinity;
    for (const direction of DIRECTIONS) {
      const moved = moveBoard(board, direction);
      if (!moved.changed) continue;
      const empty = emptyCells(moved.board);
      let expected = 0;
      for (const cell of empty) {
        for (const [tile, probability] of [[2, 0.9], [4, 0.1]]) {
          const next = cloneBoard(moved.board);
          next[cell.r][cell.c] = tile;
          const choices = DIRECTIONS.map((dir) => moveBoard(next, dir)).filter((result) => result.changed);
          expected += (choices.length ? Math.max(...choices.map((result) => evaluate(result.board))) : -100000) * probability / empty.length;
        }
      }
      const value = evaluate(moved.board) * 0.3 + (empty.length ? expected : evaluate(moved.board)) * 0.7 + moved.gained * 0.08;
      if (value > bestValue) { bestValue = value; best = direction; }
    }
    return best;
  }

  function isBoard(board, size) {
    return Array.isArray(board) && board.length === size && board.every((row) => Array.isArray(row) && row.length === size && row.every((v) => v === 0 || (Number.isSafeInteger(v) && v >= 2 && Number.isInteger(Math.log2(v)))));
  }

  /** Two deliberately different local strategies for the spectating mode. */
  function cpuDirection(board, strategy = 'planner') {
    if (strategy === 'planner') return hint(board);
    if (strategy !== 'greedy') throw new Error('Unknown CPU strategy');
    let best = null, bestValue = -Infinity;
    for (const direction of DIRECTIONS) {
      const result = moveBoard(board, direction);
      if (!result.changed) continue;
      const max = highest(result.board), end = board.length - 1;
      const corner = [result.board[0][0], result.board[0][end], result.board[end][0], result.board[end][end]].includes(max);
      const value = result.gained * 8 + emptyCells(result.board).length * 3 + (corner ? Math.log2(max) : 0);
      if (value > bestValue) { bestValue = value; best = direction; }
    }
    return best;
  }

  function compareRuns(left, right) {
    const difference = left.score - right.score || highest(left.board) - highest(right.board);
    return difference > 0 ? 'left' : difference < 0 ? 'right' : 'draw';
  }

  /** Treat persisted data as untrusted. Return only the supported state fields. */
  function validateState(value, mode, date = utcDate()) {
    if (!value || value.version !== 1 || !Object.hasOwn(MODES, mode) || value.mode !== mode || value.size !== MODES[mode]) return null;
    if ((mode === 'daily' && value.date !== date) || (mode !== 'daily' && value.date !== null)) return null;
    if (!isBoard(value.board, value.size) || value.board.flat().filter(Boolean).length < 2) return null;
    if (![value.score, value.moves].every((v) => Number.isSafeInteger(v) && v >= 0) || !Number.isInteger(value.rng) || value.rng <= 0 || value.rng > 0xffffffff) return null;
    if (typeof value.won !== 'boolean' || typeof value.continued !== 'boolean' || (value.continued && !value.won) || value.won !== (highest(value.board) >= goalFor(mode))) return null;
    const undosUsed = value.undosUsed === undefined ? 0 : value.undosUsed;
    const hintsUsed = value.hintsUsed === undefined ? 0 : value.hintsUsed;
    if (![undosUsed, hintsUsed].every((n) => Number.isInteger(n) && n >= 0 && n <= ASSIST_LIMIT)) return null;
    if (moveLimitFor(mode) !== null && value.moves > moveLimitFor(mode)) return null;
    return { version: 1, mode, size: value.size, date: value.date, board: cloneBoard(value.board), rng: value.rng, score: value.score, moves: value.moves, won: value.won, continued: value.continued, undosUsed, hintsUsed };
  }

  return Object.freeze({ MODES, ASSIST_LIMIT, goalFor, moveLimitFor, roundOver, undoGame, useHint, DIRECTIONS, cloneBoard, highest, utcDate, seedFrom, randomStep, emptyCells, spawnTile, createGame, moveBoard, canMove, play, hint, cpuDirection, compareRuns, isBoard, validateState });
});
