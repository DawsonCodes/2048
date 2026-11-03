/* Worker-backed local CPU; no inference service, training, or repo writes. */
(function () {
  'use strict';
  let worker;
  let nextId = 0;
  const pending = new Map();
  function fallback(board, difficulty) {
    return new Promise((resolve) => setTimeout(() => resolve(window.RemixAI.choose(board, difficulty)), 0));
  }
  function disableWorker() {
    if (worker) worker.terminate();
    worker = null;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      fallback(entry.board, entry.difficulty).then(entry.resolve);
    }
    pending.clear();
  }
  try {
    if (window.Worker && location.protocol !== 'file:') {
      worker = new Worker('cpu-worker.js?v=2.2.0');
      worker.addEventListener('message', ({ data }) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id); clearTimeout(entry.timer);
        if (data.error) fallback(entry.board, entry.difficulty).then(entry.resolve);
        else entry.resolve(data.direction);
      });
      worker.addEventListener('error', disableWorker);
    }
  } catch { worker = null; }
  function choose(board, difficulty) {
    if (!worker) return fallback(board, difficulty);
    return new Promise((resolve) => {
      const id = ++nextId;
      const timer = setTimeout(disableWorker, 4000);
      pending.set(id, { resolve, timer, board, difficulty });
      try { worker.postMessage({ id, board, difficulty }); } catch { disableWorker(); }
    });
  }
  window.RemixCPU = Object.freeze({ choose });
})();
