/* All CPU planning happens locally, away from rendering and input. */
importScripts('engine.js', 'cpu-ai.js');
self.addEventListener('message', (event) => {
  const { id, board, difficulty } = event.data;
  try {
    if (!Array.isArray(board) || !self.Remix2048.isBoard(board, board.length)) throw new Error('Invalid CPU board');
    self.postMessage({ id, direction: self.RemixAI.choose(board, difficulty) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
});
