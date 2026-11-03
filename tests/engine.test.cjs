const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const board = (row) => [row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const sum = (grid) => grid.flat().reduce((a, b) => a + b, 0);

test('a fresh board has two tiles, zero score, and the right dimensions in every mode', () => {
  for (const mode of Object.keys(E.MODES)) {
    const game = E.createGame(mode, '2026-11-03', 123456);
    assert.equal(game.board.length, E.MODES[mode]);
    assert.equal(game.board.flat().filter(Boolean).length, 2);
    assert.equal(game.moves, 0);
    assert.equal(game.score, 0);
    assert.ok(E.validateState(game, mode, '2026-11-03'));
  }
});
test('four equal tiles form two pairs, with no double merge', () => {
  const result = E.moveBoard(board([2, 2, 2, 2]), 'left');
  assert.deepEqual(result.board[0], [4, 4, 0, 0]);
  assert.equal(result.gained, 8);
  assert.equal(result.motions.length, 4);
  assert.equal(result.merges.length, 2);
});
test('a newly merged tile cannot merge again in the same turn', () => {
  assert.deepEqual(E.moveBoard(board([2, 2, 4, 0]), 'left').board[0], [4, 4, 0, 0]);
  assert.deepEqual(E.moveBoard(board([4, 2, 2, 0]), 'right').board[0], [0, 0, 4, 4]);
});
test('three equal tiles pair from the direction of travel', () => {
  assert.deepEqual(E.moveBoard(board([2, 2, 2, 0]), 'left').board[0], [4, 2, 0, 0]);
  assert.deepEqual(E.moveBoard(board([2, 2, 2, 0]), 'right').board[0], [0, 0, 2, 4]);
});
test('empty cells collapse before merging', () => {
  const input = board([0, 2, 0, 2]);
  const before = structuredClone(input);
  assert.deepEqual(E.moveBoard(input, 'left').board[0], [4, 0, 0, 0]);
  assert.deepEqual(input, before);
});
test('up and down merge columns in the correct order', () => {
  const input = [[2, 4, 0, 0], [2, 4, 0, 0], [4, 4, 0, 0], [0, 4, 0, 0]];
  assert.deepEqual(E.moveBoard(input, 'up').board, [[4, 8, 0, 0], [4, 8, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual(E.moveBoard(input, 'down').board, [[0, 0, 0, 0], [0, 0, 0, 0], [4, 8, 0, 0], [4, 8, 0, 0]]);
});
test('a move that does nothing changes neither board, score, move count, nor random sequence', () => {
  const game = E.createGame('classic');
  game.board = board([2, 4, 0, 0]);
  const before = structuredClone(game);
  const result = E.play(game, 'left');
  assert.equal(result.changed, false);
  assert.equal(result.state, game);
  assert.equal(result.spawn, null);
  assert.deepEqual(game, before);
});
test('a valid move adds exactly one new tile and the merge value to the score', () => {
  const game = E.createGame('classic');
  game.board = board([2, 2, 4, 4]);
  const result = E.play(game, 'left');
  assert.equal(result.gained, 12);
  assert.equal(result.state.score, 12);
  assert.equal(result.state.moves, 1);
  assert.equal(result.state.board.flat().filter(Boolean).length, 3);
  assert.equal(sum(result.state.board), sum(game.board) + result.spawn.value);
});
test('full boards with no matches end the game', () => {
  const blocked = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
  assert.equal(E.canMove(blocked), false);
  assert.equal(E.hint(blocked), null);
  for (const direction of E.DIRECTIONS) assert.equal(E.moveBoard(blocked, direction).changed, false);
});
test('a full board with an adjacent match stays playable', () => {
  assert.equal(E.canMove([[2, 2, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]]), true);
});
test('a non-full board is playable', () => {
  assert.equal(E.canMove(board([2, 4, 0, 0])), true);
});
test('2048 triggers the win state and Classic can continue beyond it', () => {
  const game = E.createGame('classic');
  game.board = board([1024, 1024, 0, 0]);
  const won = E.play(game, 'left').state;
  assert.equal(won.won, true);
  assert.equal(won.continued, false);
  assert.equal(won.score, 2048);
  assert.ok(E.validateState(won, 'classic'));
  const continued = { ...won, continued: true };
  assert.equal(E.play(continued, 'down').state.continued, true);
});
test('Zen keeps going automatically at 2048', () => {
  const game = E.createGame('zen');
  game.board = Array.from({ length: 5 }, () => Array(5).fill(0));
  game.board[0] = [1024, 1024, 0, 0, 0];
  const won = E.play(game, 'left').state;
  assert.equal(won.won, true);
  assert.equal(won.continued, true);
});
test('Daily ignores the supplied random seed and replays deterministically', () => {
  let first = E.createGame('daily', '2026-11-03', 12);
  let second = E.createGame('daily', '2026-11-03', 987654);
  assert.deepEqual(first, second);
  for (let i = 0; i < 60; i++) {
    const direction = E.DIRECTIONS[i % 4];
    first = E.play(first, direction).state;
    second = E.play(second, direction).state;
    assert.deepEqual(first, second);
  }
  assert.notEqual(E.createGame('daily', '2026-11-04').rng, E.createGame('daily', '2026-11-03').rng);
});
test('restoring a pre-move snapshot replays the same spawn, including after JSON storage', () => {
  const game = E.createGame('daily', '2026-11-03');
  const direction = E.hint(game.board);
  const expected = E.play(game, direction).state;
  const restored = E.validateState(JSON.parse(JSON.stringify(game)), 'daily', '2026-11-03');
  assert.deepEqual(E.play(restored, direction).state, expected);
});
test('a hint is a legal move and does not mutate the board or random state', () => {
  for (const mode of Object.keys(E.MODES)) {
    const game = E.createGame(mode);
    const before = structuredClone(game);
    const direction = E.hint(game.board);
    assert.ok(E.DIRECTIONS.includes(direction));
    assert.equal(E.moveBoard(game.board, direction).changed, true);
    assert.deepEqual(game, before);
  }
});
test('malformed, mismatched, and stale saved states are rejected', () => {
  const good = E.createGame('daily', '2026-11-03');
  for (const invalid of [null, {}, { ...good, version: 7 }, { ...good, size: 5 }, { ...good, rng: 0 }, { ...good, rng: -1 }, { ...good, score: -1 }, { ...good, moves: 1.5 }, { ...good, board: [[3]] }, { ...good, won: 'yes' }, { ...good, continued: true }, { ...good, won: true }]) {
    assert.equal(E.validateState(invalid, 'daily', '2026-11-03'), null);
  }
  assert.equal(E.validateState(good, 'daily', '2026-11-04'), null);
  assert.equal(E.validateState(good, 'classic', '2026-11-03'), null);
  assert.equal(E.validateState(good, '__proto__', '2026-11-03'), null);
});
test('saved boards accept only square arrays of safe powers of two', () => {
  assert.equal(E.isBoard([[2, 3], [0, 0]], 2), false);
  assert.equal(E.isBoard([[2, NaN], [0, 0]], 2), false);
  assert.equal(E.isBoard([[2, 2 ** 54], [0, 0]], 2), false);
  assert.equal(E.isBoard([[2, 4], [8]], 2), false);
  assert.equal(E.isBoard([[2, 4], [8, 0]], 2), true);
});
test('validation returns an independent copy and strips unsupported fields', () => {
  const game = E.createGame('classic');
  const restored = E.validateState({ ...game, extra: 'ignore me' }, 'classic');
  assert.ok(restored);
  assert.equal(restored.extra, undefined);
  restored.board[0][0] = 4096;
  assert.notDeepEqual(restored.board, game.board);
});
test('randomized games conserve tile totals before spawning and remain valid after every move', () => {
  for (const mode of Object.keys(E.MODES)) {
    for (let seed = 1; seed <= 15; seed++) {
      let game = E.createGame(mode, '2026-11-03', seed * 76543);
      for (let turn = 0; turn < 120; turn++) {
        const direction = E.DIRECTIONS[(turn * 7 + seed) % 4];
        const moved = E.moveBoard(game.board, direction);
        assert.equal(sum(moved.board), sum(game.board));
        assert.equal(moved.gained, moved.merges.reduce((s, tile) => s + tile.value, 0));
        const next = E.play(game, direction);
        if (next.changed) {
          assert.ok([2, 4].includes(next.spawn.value));
          assert.equal(sum(next.state.board), sum(game.board) + next.spawn.value);
        } else assert.equal(next.state.rng, game.rng);
        game = next.state;
        assert.ok(E.validateState(game, mode, '2026-11-03'));
      }
    }
  }
});
test('UTC dates agree across local offsets around midnight', () => {
  assert.equal(E.utcDate(new Date('2026-11-02T23:30:00-05:00')), '2026-11-03');
  assert.equal(E.utcDate(new Date('2026-11-03T01:00:00+02:00')), '2026-11-02');
});
test('unknown modes and directions fail explicitly', () => {
  assert.throws(() => E.createGame('constructor'), /Unknown game mode/);
  assert.throws(() => E.moveBoard(board([2, 4, 0, 0]), 'diagonal'), /Unknown direction/);
});
