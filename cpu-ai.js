/* Fixed local CPU evaluator and bounded expectimax search. */
(function (root, factory) {
  'use strict';
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.Remix2048;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RemixAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  const LEVELS = Object.freeze(['easy', 'normal', 'hard', 'insane']);
  const WEIGHTS = Object.freeze([0.1, 2.7, 0.7, 1.5, 0.9, 0.2, 0.5, 0.4]);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function features(board) {
    const size = board.length, max = E.highest(board), logs = board.map((row) => row.map((n) => n ? Math.log2(n) : 0));
    let smooth = 0, monotonic = 0, pairs = 0, edge = 0;
    for (let r = 0; r < size; r++) {
      let up = 0, down = 0, colUp = 0, colDown = 0;
      for (let c = 0; c < size; c++) {
        if (r === 0 || c === 0 || r === size - 1 || c === size - 1) edge += board[r][c];
        if (c === size - 1) continue;
        const a = logs[r][c], b = logs[r][c + 1], x = logs[c][r], y = logs[c + 1][r];
        up += Math.max(0, b - a); down += Math.max(0, a - b);
        colUp += Math.max(0, y - x); colDown += Math.max(0, x - y);
        if (a && b) { smooth -= Math.abs(a - b); if (a === b) pairs++; }
        if (x && y) { smooth -= Math.abs(x - y); if (x === y) pairs++; }
      }
      monotonic -= Math.min(up, down) + Math.min(colUp, colDown);
    }
    const end = size - 1, corner = [board[0][0], board[0][end], board[end][0], board[end][end]].includes(max);
    const total = board.flat().reduce((sum, n) => sum + n, 0) || 1;
    return [1, E.emptyCells(board).length / (size * size), clamp(smooth / 64, -1, 0), clamp(monotonic / 64, -1, 0), corner ? 1 : 0, clamp(Math.log2(max) / 32, 0, 1), pairs / (size * size * 2), edge / total];
  }
  function value(board) {
    if (!E.canMove(board)) return -10;
    const f = features(board);
    return f.reduce((sum, n, i) => sum + n * WEIGHTS[i], 0);
  }
  function choices(board) { return E.DIRECTIONS.map((direction) => ({ direction, ...E.moveBoard(board, direction) })).filter((move) => move.changed); }
  function choose(board, level = 'normal') {
    if (!LEVELS.includes(level)) throw new Error('Unknown CPU difficulty');
    const moves = choices(board);
    if (!moves.length) return null;
    if (level === 'easy') {
      const step = E.randomStep(E.seedFrom(board.flat().join(',') + ':easy'));
      if (step.value < 0.65) return moves[Math.floor(E.randomStep(step.seed).value * moves.length)].direction;
    }
    let best = moves[0].direction, bestValue = -Infinity;
    for (const move of moves) {
      const evaluation = value(move.board) + Math.log2(1 + move.gained) * 0.08;
      if (evaluation > bestValue) { bestValue = evaluation; best = move.direction; }
    }
    if (level === 'easy' || level === 'normal') return best;
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const deadline = now() + (level === 'insane' ? 90 : 35);
    const maxDepth = level === 'insane' ? 3 : 2;
    const maxCells = level === 'insane' ? 6 : 4;
    const cache = new Map();
    const timeout = {};
    function checkTime() { if (now() > deadline) throw timeout; }
    function chance(boardAfter, depth) {
      checkTime();
      const empty = E.emptyCells(boardAfter);
      if (!empty.length) return value(boardAfter);
      const sample = empty.length <= maxCells ? empty : Array.from({ length: maxCells }, (_, i) => empty[Math.floor(i * empty.length / maxCells)]);
      let result = 0;
      for (const cell of sample) {
        for (const [tile, probability] of [[2, 0.9], [4, 0.1]]) {
          const spawned = E.cloneBoard(boardAfter); spawned[cell.r][cell.c] = tile;
          result += (depth > 0 ? search(spawned, depth) : value(spawned)) * probability / sample.length;
        }
      }
      return result;
    }
    function search(position, depth) {
      checkTime();
      const key = depth + ':' + position.flat().join(',');
      if (cache.has(key)) return cache.get(key);
      const available = choices(position);
      let result = -10;
      for (const move of available) result = Math.max(result, Math.log2(1 + move.gained) * 0.08 + 0.985 * chance(move.board, depth - 1));
      if (cache.size < 12000) cache.set(key, result);
      return result;
    }
    for (let depth = 1; depth <= maxDepth; depth++) {
      try {
        let candidate = best, candidateValue = -Infinity;
        for (const move of moves) {
          const evaluation = Math.log2(1 + move.gained) * 0.08 + 0.985 * chance(move.board, depth - 1);
          if (evaluation > candidateValue) { candidateValue = evaluation; candidate = move.direction; }
        }
        best = candidate;
      } catch (error) { if (error !== timeout) throw error; break; }
    }
    return best;
  }
  return Object.freeze({ LEVELS, features, value, choose });
});
