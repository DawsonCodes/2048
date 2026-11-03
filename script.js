/* Browser controller. Progress stays on this device; audio assets are local. */
(function () {
  'use strict';
  const E = globalThis.Remix2048;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const board = $('game-board');
  const layer = $('tile-layer');
  const menu = $('theme-menu');
  const trigger = $('theme-trigger');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const directions = [...document.querySelectorAll('[data-direction]')];
  const names = { classic: 'Classic', daily: 'Daily', zen: 'Zen', tiny: 'Tiny', sprint: 'Sprint', versus: 'Player vs CPU', arena: 'CPU vs CPU' };
  const arrows = { left: '←', right: '→', up: '↑', down: '↓' };
  const themeNames = { 'gray-dark': 'Gray Dark', light: 'Light', 'ms-paint': 'MS Paint' };
  const memory = new Map();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lessMotion = root.dataset.lessMotion === 'true';
  let soundOn = read('sound') === '1';
  const audioBank = window.RemixAudio;
  let undoAnimationTimer;
  let state;
  let history = [];
  let busy = false;
  let revision = 0;
  let animationTimer;
  let animationFrame;
  let toastTimer;
  let hintTimer;
  let themeTransition;
  let pointer = null;
  let queue = [];
  const cpu = window.RemixCPU;
  let opponent = null;
  let opponentHistory = [];
  let cpuBusy = false, cpuVersion = 0, cpuTimer, cpuPaintTimer, cpuFrame, clockTimer;
  let duelPaused = false, duelPending = false, duelElapsed = 0, clockStarted = null;
  let leftLevel = 'hard', rightLevel = 'normal', cpuSpeed = 2;
  let currentMode = read('last-mode');
  if (!Object.hasOwn(E.MODES, currentMode)) currentMode = 'classic';

  function read(key) {
    if (memory.has(key)) return memory.get(key);
    try { return localStorage.getItem('2048-remix:' + key); } catch { return null; }
  }
  function write(key, value) {
    memory.set(key, value);
    try { localStorage.setItem('2048-remix:' + key, value); } catch { /* In-memory play remains available. */ }
  }
  function reduced() { return lessMotion || media.matches; }
  function randomSeed() {
    if (globalThis.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
  }
  function snapshot() { return { ...state, board: E.cloneBoard(state.board) }; }
  function bestScore() {
    const saved = Number(read('best:' + currentMode));
    return Math.max(state.score, Number.isSafeInteger(saved) && saved >= 0 ? saved : 0);
  }
  function save() {
    if (!state) return;
    const payload = { ...state, history };
    if (isDuel()) Object.assign(payload, { opponent, opponentHistory, duelPaused, duelPending, duelElapsed: elapsedNow(), leftLevel, rightLevel, cpuSpeed });
    write('game:' + currentMode, JSON.stringify(payload));
    write('best:' + currentMode, String(bestScore()));
    write('last-mode', currentMode);
  }
  function loadMode(mode) {
    if (state) save();
    cancelAnimation();
    currentMode = mode;
    let saved = null;
    try { saved = JSON.parse(read('game:' + mode)); } catch { /* Recover malformed storage. */ }
    state = E.validateState(saved, mode);
    history = state && Array.isArray(saved.history) ? saved.history.slice(-E.ASSIST_LIMIT).map((entry) => E.validateState(entry, mode)).filter(Boolean) : [];
    opponent = null; opponentHistory = [];
    duelPaused = false; duelPending = false; duelElapsed = 0;
    leftLevel = 'hard'; rightLevel = mode === 'arena' ? 'insane' : 'normal'; cpuSpeed = 2;
    if (isDuel()) {
      opponent = E.validateState(saved && saved.opponent, mode);
      if (!state || !opponent) {
        const seed = randomSeed();
        state = E.createGame(mode, E.utcDate(), seed);
        opponent = E.createGame(mode, E.utcDate(), seed);
        history = [];
      } else {
        opponentHistory = Array.isArray(saved.opponentHistory) ? saved.opponentHistory.slice(-E.ASSIST_LIMIT).map((entry) => E.validateState(entry, mode)).filter(Boolean) : [];
        if (history.length !== opponentHistory.length) { history = []; opponentHistory = []; }
        duelPaused = saved.duelPaused === true;
        duelPending = mode === 'versus' && saved.duelPending === true && !E.roundOver(opponent);
        duelElapsed = Number.isFinite(saved.duelElapsed) && saved.duelElapsed >= 0 ? Math.min(saved.duelElapsed, 31536000000) : 0;
        if (['easy', 'normal', 'hard', 'insane'].includes(saved.leftLevel)) leftLevel = saved.leftLevel;
        if (['easy', 'normal', 'hard', 'insane'].includes(saved.rightLevel)) rightLevel = saved.rightLevel;
        if ([1, 2, 4, 8].includes(saved.cpuSpeed)) cpuSpeed = saved.cpuSpeed;
      }
      if (E.roundOver(state) && E.roundOver(opponent)) duelPaused = true;
    }
    if (!state) state = E.createGame(mode, E.utcDate(), randomSeed());
    clearHint(); save(); renderAll(); resumeCPU();
    $('game-announcer').textContent = names[mode] + ' board. Score ' + state.score + '. Move ' + state.moves + '.';
  }
  function cancelAnimation() {
    haltCPU();
    revision++;
    clearTimeout(animationTimer);
    cancelAnimationFrame(animationFrame);
    busy = false;
    queue = [];
    pointer = null;
    $('particles').replaceChildren();
  }
  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('is-visible');
    toastTimer = setTimeout(() => { $('toast').classList.remove('is-visible'); $('toast').textContent = ''; }, 3600);
  }
  function clearHint() {
    clearTimeout(hintTimer);
    directions.forEach((button) => button.classList.remove('is-hint'));
    $('board-message').classList.remove('has-hint');
  }
  function checkDate() {
    updateDailyLabel();
    if (currentMode === 'daily' && state.date !== E.utcDate()) {
      loadMode('daily');
      showToast('New Daily challenge ready.');
      return true;
    }
    return false;
  }
  function updateDailyLabel() {
    $('daily-date').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date()).toUpperCase();
    $('mode-daily').title = 'Daily challenge · ' + E.utcDate() + ' · resets at 00:00 UTC';
  }

  function makeTile(r, c, value, className = '') {
    const tile = document.createElement('div');
    tile.className = 'tile ' + className;
    tile.dataset.level = String(Math.min(12, Math.log2(value)));
    tile.style.setProperty('--x', c);
    tile.style.setProperty('--y', r);
    const face = document.createElement('div');
    face.className = 'tile-face';
    face.textContent = String(value);
    if (String(value).length > 4) face.classList.add('tile-small');
    tile.append(face);
    return tile;
  }
  function renderGridInto(game, element, grid) {
    element.style.setProperty('--size', game.size);
    element.dataset.size = game.size;
    const rows = document.createDocumentFragment();
    game.board.forEach((values, r) => {
      const row = document.createElement('div'); row.className = 'board-row'; row.setAttribute('role', 'row');
      values.forEach((value, c) => {
        const cell = document.createElement('div'); cell.className = 'cell'; cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + (value || 'empty'));
        row.append(cell);
      }); rows.append(row);
    });
    grid.replaceChildren(rows);
    grid.setAttribute('aria-rowcount', game.size); grid.setAttribute('aria-colcount', game.size);
  }
  function renderGrid() { renderGridInto(state, board, $('board-grid')); }
  function tilesInto(game, element, merges = [], spawn = null) {
    const fragment = document.createDocumentFragment();
    game.board.forEach((row, r) => row.forEach((value, c) => {
      if (!value) return;
      const merged = merges.some((tile) => tile.r === r && tile.c === c);
      const spawned = spawn && spawn.r === r && spawn.c === c;
      fragment.append(makeTile(r, c, value, merged ? 'is-merged' : spawned ? 'is-spawned' : ''));
    }));
    element.replaceChildren(fragment);
  }
  function renderTiles(merges = [], spawn = null) { tilesInto(state, layer, merges, spawn); }
  function renderInfo() {
    $('main').classList.toggle('is-duel', isDuel());
    $('main').classList.toggle('is-spectating', currentMode === 'arena');
    board.setAttribute('aria-label', currentMode === 'arena' ? 'CPU A 2048 board, played automatically by the CPU.' : '2048 game board. Use arrow keys or W A S D to move.');
    $('duel-toolbar').hidden = !isDuel();
    $('opponent-panel').hidden = !isDuel();
    $('assistance-tools').hidden = currentMode === 'arena';
    document.querySelector('.touch-controls').hidden = currentMode === 'arena';
    document.querySelector('.keyboard-note').hidden = currentMode === 'arena';
    $('player-score-label').textContent = currentMode === 'arena' ? 'CPU A' : currentMode === 'versus' ? 'You' : 'Score';
    $('score').textContent = state.score.toLocaleString();
    $('best').textContent = bestScore().toLocaleString();
    const limit = E.moveLimitFor(currentMode);
    $('moves-label').textContent = limit === null ? 'Moves' : 'Moves left';
    $('moves').textContent = (limit === null ? state.moves : Math.max(0, limit - state.moves)).toLocaleString();
    const top = E.highest(state.board);
    const goal = E.goalFor(currentMode);
    const target = top >= goal ? top * 2 : goal;
    $('top-tile').textContent = top.toLocaleString();
    $('target').textContent = String(target);
    const percent = Math.round(Math.min(1, Math.log2(top) / Math.log2(target)) * 100);
    $('goal-percent').textContent = percent + '%';
    $('goal-fill').style.width = percent + '%';
    $('goal-progress').setAttribute('aria-valuenow', percent);
    $('goal-progress').setAttribute('aria-label', 'Highest tile progress toward ' + target);
    $('goal-progress').setAttribute('aria-valuetext', top + ' tile, target ' + target);
    $('goal-copy').textContent = top.toLocaleString() + ' / ' + target.toLocaleString();
    const milestones = currentMode === 'tiny' ? [4, 16, 64, 256, 512] : [8, 32, 128, 512, 2048];
    document.querySelectorAll('[data-milestone]').forEach((el, index) => {
      el.dataset.milestone = milestones[index];
      el.firstChild.textContent = String(milestones[index]) + (index === 4 ? ' ' : '');
      el.classList.toggle('is-reached', top >= milestones[index]);
    });
    const over = E.roundOver(state);
    const paused = state.won && !state.continued;
    const undosLeft = E.ASSIST_LIMIT - state.undosUsed;
    const hintsLeft = E.ASSIST_LIMIT - state.hintsUsed;
    $('undos-left').textContent = undosLeft;
    $('hints-left').textContent = hintsLeft;
    $('undo').disabled = !history.length || undosLeft === 0 || currentMode === 'arena';
    $('hint').disabled = over || paused || hintsLeft === 0 || currentMode === 'arena';
    $('undo').setAttribute('aria-label', 'Undo, ' + undosLeft + ' remaining');
    $('hint').setAttribute('aria-label', 'Hint, ' + hintsLeft + ' remaining');
    $('undo').title = 'Undo (U) · ' + undosLeft + ' of 3 left';
    $('hint').title = 'Hint (H) · ' + hintsLeft + ' of 3 left';
    $('board-caption').textContent = currentMode === 'arena' ? 'CPU A · ' + leftLevel.toUpperCase() : names[currentMode].toUpperCase() + ' · ' + state.size + ' × ' + state.size;
    $('board-status').textContent = over ? 'ROUND COMPLETE' : paused ? goal + ' REACHED' : limit !== null ? Math.max(0, limit - state.moves) + ' MOVES LEFT' : '';
    $('board-status').hidden = !$('board-status').textContent;
    $('board-status').classList.toggle('is-over', over);
    if (!$('board-message').classList.contains('has-hint')) $('board-message').textContent = currentMode === 'daily' ? E.utcDate() + ' · UTC' : '';
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === currentMode;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('play-panel').setAttribute('aria-labelledby', 'mode-' + currentMode);
    updateDailyLabel();
    renderDuelInfo();
  }
  function renderOverlay() {
    if (isDuel()) { renderDuelOverlay(); return; }
    const overlay = $('board-overlay');
    const won = state.won && !state.continued;
    const over = E.roundOver(state);
    const finishedSprint = currentMode === 'sprint' && state.moves >= E.moveLimitFor(currentMode);
    const wasHidden = overlay.hidden;
    overlay.hidden = !won && !over;
    board.classList.toggle('has-overlay', !overlay.hidden);
    if (overlay.hidden) return;
    overlay.dataset.phase = won ? 'won' : 'over';
    $('overlay-kicker').textContent = won ? 'TARGET REACHED' : 'ROUND COMPLETE';
    $('overlay-title').textContent = won ? E.goalFor(currentMode) + ' reached' : finishedSprint ? '50 moves complete' : 'Game over';
    $('overlay-copy').textContent = state.score.toLocaleString() + ' points · ' + state.moves + ' moves';
    $('overlay-icon').querySelector('use').setAttribute('href', won ? '#i-trophy' : '#i-reset');
    $('overlay-primary').textContent = won ? 'Continue ↗' : 'New game ↗';
    $('overlay-secondary').textContent = won ? 'New game' : 'Undo (' + (E.ASSIST_LIMIT - state.undosUsed) + ' left)';
    $('overlay-secondary').hidden = !won && (!history.length || state.undosUsed >= E.ASSIST_LIMIT);
    if (wasHidden) $('overlay-primary').focus({ preventScroll: true });
  }
  function renderAll() { renderGrid(); renderTiles(); renderInfo(); renderOpponent(); renderOverlay(); }

  function celebrate() {
    if (reduced()) return;
    const particles = document.createDocumentFragment();
    for (let i = 0; i < 20; i++) {
      const bit = document.createElement('i');
      bit.style.setProperty('--angle', i * 137.5 + 'deg');
      bit.style.setProperty('--distance', 90 + (i % 5) * 22 + 'px');
      bit.style.setProperty('--color', ['#62a8ff', '#7bdbb6', '#c1a1ff', '#ffcb75'][i % 4]);
      particles.append(bit);
    }
    $('particles').replaceChildren(particles);
  }
  function playSound(name, tile) {
    if (!soundOn) return;
    audioBank.play(name, tile).then((ok) => {
      if (!ok && soundOn) {
        soundOn = false;
        audioBank.setEnabled(false);
        write('sound', '0'); updateSound();
        showToast('Audio could not load. Toggle sound to retry.');
      }
    });
  }
  function move(direction) {
    if (currentMode === 'arena' || (isDuel() && duelPaused)) return;
    if (checkDate()) return;
    if (!$('board-overlay').hidden || document.querySelector('dialog[open]') || !menu.hidden) return;
    if (busy || cpuBusy || (isDuel() && duelPending)) { if (queue.length < 2) queue.push(direction); resumeCPU(); return; }
    const previous = snapshot();
    const result = E.play(state, direction);
    clearHint();
    if (!result.changed) {
      $('board-message').textContent = 'Try another direction.';
      return;
    }
    if (isDuel()) {
      opponentHistory.push({ ...opponent, board: E.cloneBoard(opponent.board) });
      if (opponentHistory.length > E.ASSIST_LIMIT) opponentHistory.shift();
      duelPending = !E.roundOver(opponent);
    }
    history.push(previous);
    if (history.length > E.ASSIST_LIMIT) history.shift();
    state = result.state;
    if (isDuel()) startCPUClock();
    save();
    renderInfo();
    renderGrid();
    busy = true;
    const token = revision;
    if (result.gained) {
      $('score-add').textContent = '+' + result.gained.toLocaleString();
      $('score-add').classList.remove('is-active');
      void $('score-add').offsetWidth;
      $('score-add').classList.add('is-active');
      const biggest = Math.max(...result.merges.map((tile) => tile.value));
      playSound(biggest >= 128 ? 'milestone' : 'merge', biggest);
    }
    if (!result.gained) playSound('slide');
    const finish = () => {
      if (token !== revision) return;
      renderTiles(result.merges, result.spawn);
      if (state.won && !previous.won) {
        celebrate();
        playSound('confirm');
      }
      renderOverlay();
      $('game-announcer').textContent = 'Move ' + state.moves + '. Score ' + state.score + '. Top tile ' + E.highest(state.board) + '.' + (E.roundOver(state) ? ' Round complete.' : state.won && !previous.won ? ' Target reached!' : '');
      busy = false;
      if (isDuel() && duelPending) { cpuStep(); return; }
      const next = queue.shift();
      if (next) move(next);
      else resumeCPU();
    };
    if (reduced()) { finish(); return; }
    const fragment = document.createDocumentFragment();
    const moving = result.motions.map((motion) => {
      const el = makeTile(motion.from.r, motion.from.c, motion.value, 'is-moving');
      fragment.append(el);
      return { el, motion };
    });
    layer.replaceChildren(fragment);
    void layer.offsetWidth;
    animationFrame = requestAnimationFrame(() => {
      if (token !== revision) return;
      moving.forEach(({ el, motion }) => { el.style.setProperty('--x', motion.to.c); el.style.setProperty('--y', motion.to.r); });
      animationTimer = setTimeout(finish, 135);
    });
  }
  function undo() {
    if (checkDate() || !history.length) return;
    const restored = E.undoGame(state, history.at(-1));
    if (!restored) { showToast('No undos left for this run.'); return; }
    cancelAnimation();
    history.pop();
    state = restored;
    if (isDuel()) {
      opponent = opponentHistory.pop();
      duelPending = false; duelPaused = false;
    }
    clearHint();
    save(); renderAll();
    board.focus({ preventScroll: true });
    clearTimeout(undoAnimationTimer);
    $('undo').classList.remove('is-rewinding');
    void $('undo').offsetWidth;
    $('undo').classList.add('is-rewinding');
    undoAnimationTimer = setTimeout(() => $('undo').classList.remove('is-rewinding'), 480);
    playSound('undo');
    resumeCPU();
    $('game-announcer').textContent = 'Move undone. Score ' + state.score + '. ' + (E.ASSIST_LIMIT - state.undosUsed) + ' undos remaining.';
  }
  function getHint() {
    if (currentMode === 'arena' || cpuBusy || (isDuel() && duelPaused)) return;
    if (busy || checkDate() || !$('board-overlay').hidden || document.querySelector('dialog[open]') || !menu.hidden) return;
    if ($('board-message').classList.contains('has-hint')) return;
    if (state.hintsUsed >= E.ASSIST_LIMIT) { showToast('No hints left for this run.'); return; }
    const direction = E.hint(state.board);
    const assisted = E.useHint(state);
    if (!direction || !assisted) return;
    state = assisted;
    clearHint();
    save(); renderInfo();
    $('board-message').textContent = 'Try ' + arrows[direction] + ' ' + direction;
    $('board-message').classList.add('has-hint');
    directions.find((button) => button.dataset.direction === direction).classList.add('is-hint');
    playSound('hint');
    $('game-announcer').textContent = 'Try ' + direction + '. ' + (E.ASSIST_LIMIT - state.hintsUsed) + ' hints remaining.';
    hintTimer = setTimeout(() => { clearHint(); renderInfo(); }, 6000);
  }
  function newGame() {
    cancelAnimation();
    const seed = randomSeed();
    state = E.createGame(currentMode, E.utcDate(), seed);
    opponent = isDuel() ? E.createGame(currentMode, E.utcDate(), seed) : null;
    history = []; opponentHistory = [];
    duelPaused = false; duelPending = false; duelElapsed = 0;
    clearHint(); save(); renderAll();
    root.dataset.input = 'play'; board.focus({ preventScroll: true });
    playSound('confirm'); resumeCPU();
    $('game-announcer').textContent = 'Fresh ' + names[currentMode] + ' board. Score zero.';
  }
  function requestRestart() {
    if (checkDate()) return;
    if (!state.moves) { newGame(); return; }
    $('restart-copy').textContent = currentMode === 'daily' ? 'Replay today’s same seed from the beginning. Your personal best stays.' : 'This replaces your current board. Your personal best is yours to keep.';
    $('restart-dialog').showModal();
  }

  function closeMenu(focus = false) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); }
  function openMenu(last = false) {
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll('button')];
    (last ? items.at(-1) : menu.querySelector('[role="menuitemradio"][aria-checked="true"]')).focus();
  }
  function updateThemeUI() {
    $('theme-label').textContent = themeNames[root.dataset.theme] || 'Gray Dark';
    document.querySelectorAll('[data-theme-option]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.themeOption === root.dataset.theme)));
    $('motion-toggle').setAttribute('aria-checked', String(reduced()));
    $('motion-toggle').setAttribute('aria-disabled', String(media.matches));
    $('motion-toggle').querySelector('small').textContent = media.matches ? 'Reduced by your system setting' : 'A calmer kind of remix';
  }
  function setTheme(theme, origin) {
    if (!Object.hasOwn(themeNames, theme)) return;
    const update = () => {
      root.dataset.theme = theme;
      $('theme-label').textContent = themeNames[theme];
      document.querySelector('meta[name="theme-color"]').content = { 'gray-dark': '#131518', light: '#f5f6f8', 'ms-paint': '#c0c0c0' }[theme];
      write('theme', theme); updateThemeUI();
    };
    closeMenu(true);
    if (theme === root.dataset.theme) return;
    if (!document.startViewTransition || reduced() || document.hidden) { update(); return; }
    themeTransition?.skipTransition();
    const rect = origin.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(update);
    themeTransition = transition;
    transition.ready.then(() => {
      root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] }, { duration: theme === 'ms-paint' ? 650 : 500, easing: theme === 'ms-paint' ? 'steps(9, end)' : 'cubic-bezier(.65,0,.25,1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
    transition.finished.catch(() => {}).finally(() => { if (themeTransition === transition) themeTransition = null; });
  }
  function updateSound() {
    $('sound-toggle').setAttribute('aria-pressed', String(soundOn));
    $('sound-toggle').setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
    $('sound-toggle').title = soundOn ? 'Sound on' : 'Sound off';
    $('sound-toggle').querySelector('use').setAttribute('href', soundOn ? '#i-sound' : '#i-muted');
  }

  $('new-game').addEventListener('click', requestRestart);
  $('confirm-restart').addEventListener('click', () => { $('restart-dialog').close(); newGame(); });
  $('undo').addEventListener('click', undo);
  $('hint').addEventListener('click', getHint);
  $('help-toggle').addEventListener('click', () => { closeMenu(); $('help-dialog').showModal(); });
  $('sound-toggle').addEventListener('click', () => {
    soundOn = !soundOn; write('sound', soundOn ? '1' : '0'); updateSound();
    audioBank.setEnabled(soundOn).then((ready) => {
      if (!soundOn) return;
      if (ready) playSound('confirm');
      else { soundOn = false; write('sound', '0'); updateSound(); showToast('Audio is unavailable in this browser.'); }
    });
  });
  $('overlay-primary').addEventListener('click', () => {
    if ($('board-overlay').dataset.phase === 'won') { state.continued = true; save(); renderAll(); board.focus({ preventScroll: true }); }
    else newGame();
  });
  $('overlay-secondary').addEventListener('click', () => { if ($('board-overlay').dataset.phase === 'won') requestRestart(); else undo(); });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => { if (button.dataset.mode !== currentMode) { loadMode(button.dataset.mode); playSound('slide'); } });
    button.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = modeButtons.indexOf(button);
      const count = modeButtons.length;
      const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index - 1 + count) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); event.stopPropagation();
      loadMode(modeButtons[next].dataset.mode); modeButtons[next].focus();
    });
  });
  directions.forEach((button) => button.addEventListener('click', () => move(button.dataset.direction)));
  trigger.addEventListener('click', () => { if (menu.hidden) openMenu(); else closeMenu(true); });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); event.stopPropagation(); openMenu(event.key === 'ArrowUp');
  });
  document.querySelectorAll('[data-theme-option]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeOption, trigger)));
  $('motion-toggle').addEventListener('click', () => {
    if (media.matches) { showToast('Your system has reduced motion enabled. Keeping things calm.'); return; }
    lessMotion = !lessMotion; root.dataset.lessMotion = String(lessMotion);
    write('less-motion', lessMotion ? '1' : '0'); updateThemeUI();
  });
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); closeMenu(true); return; }
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next].focus(); }
  });
  document.addEventListener('pointerdown', (event) => { root.dataset.input = 'pointer'; if (!$('theme-picker').contains(event.target)) closeMenu(); });
  $('theme-picker').addEventListener('focusout', () => { setTimeout(() => { if (!$('theme-picker').contains(document.activeElement)) closeMenu(); }, 0); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') root.dataset.input = 'keyboard';
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]') || !menu.hidden) return;
    const key = event.key.toLowerCase();
    const direction = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[key];
    if (direction) {
      if (currentMode === 'arena') return;
      if (event.target.closest('[role="tablist"]') && key.startsWith('arrow')) return;
      event.preventDefault();
      if (!$('board-overlay').hidden) return;
      root.dataset.input = 'play';
      board.focus({ preventScroll: true });
      move(direction);
    }
    else if (key === 'u' || key === 'h' || key === 'r' || key === '?') {
      event.preventDefault();
      if (key === 'u' || key === 'h') { root.dataset.input = 'play'; board.focus({ preventScroll: true }); }
      if (key === 'u') undo(); else if (key === 'h') getHint(); else if (key === 'r') requestRestart(); else $('help-dialog').showModal();
    }
  });
  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !$('board-overlay').hidden) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    board.setPointerCapture(event.pointerId);
    board.focus({ preventScroll: true });
  });
  board.addEventListener('pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
  });
  board.addEventListener('pointercancel', () => { pointer = null; });
  media.addEventListener('change', updateThemeUI);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (isDuel()) { duelPaused = true; cancelAnimation(); renderAll(); }
      else if (busy) { cancelAnimation(); renderAll(); }
      save();
    }
    else checkDate();
  });
  window.addEventListener('pageshow', () => checkDate());


  function isDuel() { return currentMode === 'versus' || currentMode === 'arena'; }
  function elapsedNow() { return duelElapsed + (clockStarted === null ? 0 : Date.now() - clockStarted); }
  function clockText() {
    const seconds = Math.floor(elapsedNow() / 1000);
    return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
  }
  function startCPUClock() {
    if (!isDuel() || duelPaused || clockStarted !== null || (E.roundOver(state) && E.roundOver(opponent))) return;
    clockStarted = Date.now();
    clockTimer = setInterval(() => { $('duel-elapsed').textContent = clockText(); }, 1000);
  }
  function stopCPUClock() {
    if (clockStarted !== null) duelElapsed += Date.now() - clockStarted;
    clockStarted = null; clearInterval(clockTimer);
  }
  function haltCPU() {
    cpuVersion++;
    clearTimeout(cpuTimer); clearTimeout(cpuPaintTimer); cancelAnimationFrame(cpuFrame);
    cpuBusy = false;
    stopCPUClock();
  }
  function renderDuelInfo() {
    if (!isDuel() || !opponent) return;
    $('duel-title').textContent = names[currentMode];
    const done = E.roundOver(state) && E.roundOver(opponent);
    $('duel-status').textContent = done ? 'Complete' : duelPaused ? 'Paused' : cpuBusy || duelPending ? 'Thinking…' : currentMode === 'arena' ? 'Running' : E.roundOver(state) ? 'CPU finishing' : 'Your turn';
    $('duel-elapsed').textContent = clockText();
    $('cpu-left-setting').hidden = currentMode !== 'arena';
    $('cpu-right-label').textContent = currentMode === 'arena' ? 'CPU B' : 'CPU';
    $('cpu-speed-setting').hidden = currentMode !== 'arena' && !E.roundOver(state);
    $('cpu-left-level').value = leftLevel; $('cpu-right-level').value = rightLevel; $('cpu-speed').value = String(cpuSpeed);
    $('cpu-pause').textContent = duelPaused ? 'Resume' : 'Pause';
    $('cpu-pause').disabled = done;
    $('cpu-thinking').hidden = !(cpuBusy || duelPending);
    $('opponent-panel').setAttribute('aria-busy', String(cpuBusy || duelPending));
  }
  function renderOpponent(result = null) {
    if (!isDuel() || !opponent) return;
    $('opponent-name').textContent = currentMode === 'arena' ? 'CPU B' : 'CPU';
    $('opponent-score').textContent = opponent.score.toLocaleString();
    $('opponent-top').textContent = E.highest(opponent.board).toLocaleString();
    $('opponent-moves').textContent = opponent.moves.toLocaleString();
    $('opponent-caption').textContent = (currentMode === 'arena' ? 'CPU B' : 'CPU') + ' · ' + rightLevel.toUpperCase();
    $('opponent-state').textContent = E.roundOver(opponent) ? 'Board full' : duelPaused ? 'Paused' : currentMode === 'versus' ? 'One move per player turn' : '';
    renderGridInto(opponent, $('opponent-board'), $('opponent-grid'));
    tilesInto(opponent, $('opponent-layer'), result ? result.merges : [], result ? result.spawn : null);
  }
  function renderDuelOverlay() {
    const overlay = $('board-overlay'), leftOver = E.roundOver(state), rightOver = E.roundOver(opponent);
    const wasHidden = overlay.hidden;
    overlay.hidden = !leftOver;
    board.classList.toggle('has-overlay', !overlay.hidden);
    if (overlay.hidden) return;
    overlay.dataset.phase = 'over';
    const complete = leftOver && rightOver;
    const winner = complete ? E.compareRuns(state, opponent) : null;
    const leftName = currentMode === 'arena' ? 'CPU A' : 'You';
    const rightName = currentMode === 'arena' ? 'CPU B' : 'CPU';
    $('overlay-kicker').textContent = complete ? 'MATCH COMPLETE' : 'BOARD FULL';
    $('overlay-title').textContent = !complete ? (currentMode === 'arena' ? 'CPU A stopped' : 'Your board is full') : winner === 'draw' ? 'Draw' : winner === 'left' ? (leftName === 'You' ? 'You win' : leftName + ' wins') : rightName + ' wins';
    $('overlay-copy').textContent = complete ? state.score.toLocaleString() + ' vs ' + opponent.score.toLocaleString() + ' points' : 'The other board keeps playing.';
    $('overlay-icon').querySelector('use').setAttribute('href', complete ? '#i-trophy' : '#i-grid');
    $('overlay-primary').textContent = 'New game ↗';
    $('overlay-secondary').textContent = 'Undo (' + (E.ASSIST_LIMIT - state.undosUsed) + ' left)';
    $('overlay-secondary').hidden = currentMode === 'arena' || !history.length || state.undosUsed >= E.ASSIST_LIMIT;
    if (wasHidden && currentMode !== 'arena') $('overlay-primary').focus({ preventScroll: true });
  }
  function resumeCPU() {
    if (!isDuel() || !opponent || duelPaused || document.hidden || cpuBusy || busy) return;
    if (E.roundOver(state) && E.roundOver(opponent)) { stopCPUClock(); return; }
    if (currentMode === 'arena' || state.moves || opponent.moves) startCPUClock();
    clearTimeout(cpuTimer);
    if (duelPending) cpuTimer = setTimeout(cpuStep, 0);
    else if (currentMode === 'arena' || E.roundOver(state)) cpuTimer = setTimeout(cpuStep, Math.max(100, 1000 / cpuSpeed));
  }
  function drawMotions(result, element) {
    if (!result || !result.changed) return [];
    const fragment = document.createDocumentFragment();
    const entries = result.motions.map((motion) => {
      const el = makeTile(motion.from.r, motion.from.c, motion.value, 'is-moving');
      fragment.append(el); return { el, motion };
    });
    element.replaceChildren(fragment);
    return entries;
  }
  async function cpuStep() {
    if (!isDuel() || !opponent || duelPaused || document.hidden || busy || cpuBusy) return;
    if (currentMode === 'versus' && !duelPending && !E.roundOver(state)) return;
    if (E.roundOver(state) && E.roundOver(opponent)) return;
    const token = cpuVersion;
    cpuBusy = true; renderDuelInfo();
    try {
      const leftNeeded = currentMode === 'arena' && !E.roundOver(state);
      const rightNeeded = !E.roundOver(opponent);
      const [leftDirection, rightDirection] = await Promise.all([
        leftNeeded ? cpu.choose(state.board, leftLevel) : null,
        rightNeeded ? cpu.choose(opponent.board, rightLevel) : null
      ]);
      if (token !== cpuVersion || duelPaused || document.hidden) return;
      let leftResult = null, rightResult = null;
      if (leftDirection) {
        leftResult = E.play(state, leftDirection); state = leftResult.state;
      }
      if (rightDirection) {
        rightResult = E.play(opponent, rightDirection); opponent = rightResult.state;
      }
      duelPending = false;
      save(); renderGrid(); renderInfo(); renderOpponent();
      const finish = () => {
        if (token !== cpuVersion) return;
        renderTiles(leftResult ? leftResult.merges : [], leftResult ? leftResult.spawn : null);
        renderOpponent(rightResult); renderOverlay();
        cpuBusy = false;
        if (E.roundOver(state) && E.roundOver(opponent)) { duelPaused = true; stopCPUClock(); }
        save(); renderDuelInfo();
        const gain = (leftResult ? leftResult.gained : 0) + (rightResult ? rightResult.gained : 0);
        if (gain) playSound('merge', Math.max(leftResult && leftResult.merges.length ? Math.max(...leftResult.merges.map((n) => n.value)) : 4, rightResult && rightResult.merges.length ? Math.max(...rightResult.merges.map((n) => n.value)) : 4));
        const next = currentMode === 'versus' && !E.roundOver(state) ? queue.shift() : null;
        if (next) move(next); else resumeCPU();
      };
      if (reduced()) { finish(); return; }
      const motions = [...drawMotions(leftResult, layer), ...drawMotions(rightResult, $('opponent-layer'))];
      void layer.offsetWidth;
      cpuFrame = requestAnimationFrame(() => {
        if (token !== cpuVersion) return;
        motions.forEach(({ el, motion }) => { el.style.setProperty('--x', motion.to.c); el.style.setProperty('--y', motion.to.r); });
        cpuPaintTimer = setTimeout(finish, 135);
      });
    } catch {
      if (token !== cpuVersion) return;
      cpuBusy = false; duelPaused = true; stopCPUClock(); save(); renderAll();
      showToast('CPU paused. Resume to try again.');
    }
  }
  $('cpu-pause').addEventListener('click', () => {
    duelPaused = !duelPaused; haltCPU(); queue = [];
    save(); renderAll(); resumeCPU();
  });
  $('cpu-left-level').addEventListener('change', () => { leftLevel = $('cpu-left-level').value; haltCPU(); save(); renderAll(); resumeCPU(); });
  $('cpu-right-level').addEventListener('change', () => { rightLevel = $('cpu-right-level').value; haltCPU(); save(); renderAll(); resumeCPU(); });
  $('cpu-speed').addEventListener('change', () => { cpuSpeed = Number($('cpu-speed').value); save(); resumeCPU(); });


  document.querySelectorAll('.button, .icon-button, .theme-trigger, .mode-card, .theme-option, .motion-option, .direction').forEach((el) => el.classList.add('joy-ring'));
  audioBank.setEnabled(soundOn);
  updateThemeUI(); updateSound(); loadMode(currentMode);
})();
