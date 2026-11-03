const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const AI = require('../cpu-ai.js');

test('every difficulty chooses a legal move without changing the board', () => {
  const game = E.createGame('arena', undefined, 192837), before = structuredClone(game);
  for (const difficulty of AI.LEVELS) {
    const direction = AI.choose(game.board, difficulty);
    assert.ok(E.DIRECTIONS.includes(direction));
    assert.equal(E.moveBoard(game.board, direction).changed, true);
  }
  assert.deepEqual(game, before);
});
test('CPU features stay finite and normalized', () => {
  for (let seed = 1; seed < 15; seed++) {
    const values = AI.features(E.createGame('arena', undefined, seed * 54321).board);
    assert.equal(values.length, 8);
    assert.ok(values.every((n) => Number.isFinite(n) && n >= -1 && n <= 1));
  }
});
test('blocked boards stop every CPU difficulty', () => {
  const board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
  for (const level of AI.LEVELS) assert.equal(AI.choose(board, level), null);
});
test('fixed local CPU play preserves game state and has no 2048 stop condition', () => {
  let game = E.createGame('arena', undefined, 45678);
  for (let turn = 0; turn < 160; turn++) {
    const direction = AI.choose(game.board, 'normal');
    if (!direction) break;
    const result = E.play(game, direction);
    assert.equal(result.changed, true);
    assert.ok(E.validateState(result.state, 'arena'));
    game = result.state;
  }
  assert.ok(game.moves > 20);
  assert.equal(game.hintsUsed, 0);
  assert.equal(game.undosUsed, 0);
});
test('CPU difficulty names are validated explicitly', () => {
  assert.throws(() => AI.choose(E.createGame().board, 'impossible'), /Unknown CPU difficulty/);
});
