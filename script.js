/* Browser controller. All progress stays on this device; no network calls. */
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
  const names = { classic: 'Classic', daily: 'Daily', zen: 'Zen' };
  const arrows = { left: '←', right: '→', up: '↑', down: '↓' };
  const themeNames = { 'gray-dark': 'Gray Dark', light: 'Light', 'ms-paint': 'MS Paint' };
  const memory = new Map();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lessMotion = root.dataset.lessMotion === 'true';
  let soundOn = read('sound') === '1';
  let audioContext;
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
    write('game:' + currentMode, JSON.stringify({ ...state, history }));
    write('best:' + currentMode, String(bestScore()));
    write('last-mode', currentMode);
  }
  function loadMode(mode) {
    cancelAnimation();
    currentMode = mode;
    let saved = null;
    try { saved = JSON.parse(read('game:' + mode)); } catch { /* Start fresh after malformed storage. */ }
    state = E.validateState(saved, mode);
    history = state && Array.isArray(saved.history) ? saved.history.slice(-32).map((entry) => E.validateState(entry, mode)).filter(Boolean) : [];
    if (!state) state = E.createGame(mode, E.utcDate(), randomSeed());
    clearHint();
    save();
    renderAll();
    $('game-announcer').textContent = names[mode] + ' board. Score ' + state.score + '. Move ' + state.moves + '.';
  }
  function cancelAnimation() {
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
      showToast('A new UTC day. A fresh Daily is ready.');
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
  function renderGrid() {
    board.style.setProperty('--size', state.size);
    board.dataset.size = state.size;
    const rows = document.createDocumentFragment();
    state.board.forEach((values, r) => {
      const row = document.createElement('div');
      row.className = 'board-row';
      row.setAttribute('role', 'row');
      values.forEach((value, c) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + (value || 'empty'));
        row.append(cell);
      });
      rows.append(row);
    });
    $('board-grid').replaceChildren(rows);
    $('board-grid').setAttribute('aria-rowcount', state.size);
    $('board-grid').setAttribute('aria-colcount', state.size);
  }
  function renderTiles(merges = [], spawn = null) {
    const fragment = document.createDocumentFragment();
    state.board.forEach((row, r) => row.forEach((value, c) => {
      if (!value) return;
      const merged = merges.some((tile) => tile.r === r && tile.c === c);
      const spawned = spawn && spawn.r === r && spawn.c === c;
      fragment.append(makeTile(r, c, value, merged ? 'is-merged' : spawned ? 'is-spawned' : ''));
    }));
    layer.replaceChildren(fragment);
  }
  function renderInfo() {
    $('score').textContent = state.score.toLocaleString();
    $('best').textContent = bestScore().toLocaleString();
    $('moves').textContent = state.moves.toLocaleString();
    const top = E.highest(state.board);
    $('top-tile').textContent = top.toLocaleString();
    const target = top >= 2048 ? top * 2 : 2048;
    $('target').textContent = String(target);
    const percent = Math.round(Math.min(1, Math.log2(top) / Math.log2(target)) * 100);
    $('goal-percent').textContent = percent + '%';
    $('goal-fill').style.width = percent + '%';
    $('goal-progress').setAttribute('aria-valuenow', percent);
    $('goal-progress').setAttribute('aria-label', 'Highest tile progress toward ' + target);
    $('goal-progress').setAttribute('aria-valuetext', top + ' tile, target ' + target);
    $('goal-copy').textContent = top < 8 ? 'It all starts with a ' + top + '.' : top < 128 ? 'A little momentum looks good.' : top < 512 ? 'Now we’re getting somewhere.' : top < 2048 ? 'That big tile is getting closer.' : 'Why stop at 2048?';
    document.querySelectorAll('[data-milestone]').forEach((el) => el.classList.toggle('is-reached', top >= Number(el.dataset.milestone)));
    const over = !E.canMove(state.board);
    const paused = state.won && !state.continued;
    $('undo').disabled = !history.length;
    $('hint').disabled = over || paused;
    $('board-caption').textContent = names[currentMode].toUpperCase() + ' · ' + state.size + ' × ' + state.size;
    $('board-status').lastChild.textContent = over ? ' ROUND COMPLETE' : paused ? ' 2048 CLUB' : ' YOUR NEXT MOVE';
    $('board-status').classList.toggle('is-over', over);
    if (!$('board-message').classList.contains('has-hint')) {
      $('board-message').textContent = currentMode === 'daily' ? E.utcDate() + ' · same seed for everyone · UTC' : currentMode === 'zen' ? 'A little more space to make your next move.' : state.moves ? 'Nice and easy. You’ve got this.' : 'Make a move. Find your rhythm.';
    }
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === currentMode;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('play-panel').setAttribute('aria-labelledby', 'mode-' + currentMode);
    updateDailyLabel();
  }
  function renderOverlay() {
    const overlay = $('board-overlay');
    const won = state.won && !state.continued;
    const over = !E.canMove(state.board);
    const wasHidden = overlay.hidden;
    overlay.hidden = !won && !over;
    board.classList.toggle('has-overlay', !overlay.hidden);
    if (overlay.hidden) return;
    overlay.dataset.phase = won ? 'won' : 'over';
    $('overlay-kicker').textContent = won ? 'LOOK AT YOU GO' : 'THAT WAS A GOOD RUN';
    $('overlay-title').textContent = won ? '2048. You did that.' : 'Room for one more try?';
    $('overlay-copy').textContent = won ? 'A little patience. A lot of good merges.' : state.score.toLocaleString() + ' points, ' + state.moves + ' moves. Every board teaches you something.';
    $('overlay-icon').querySelector('use').setAttribute('href', won ? '#i-trophy' : '#i-reset');
    $('overlay-primary').textContent = won ? 'Keep going ↗' : 'Try again ↗';
    $('overlay-secondary').textContent = won ? 'Start a fresh board' : 'Undo the last move';
    $('overlay-secondary').hidden = !won && !history.length;
    if (wasHidden) $('overlay-primary').focus({ preventScroll: true });
  }
  function renderAll() { renderGrid(); renderTiles(); renderInfo(); renderOverlay(); }

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
  function playTone(value) {
    if (!soundOn) return;
    try {
      if (!audioContext) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('Audio unavailable');
        audioContext = new Context();
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      const frequency = 220 * Math.pow(2, Math.min(11, Math.log2(value)) / 12);
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + 0.07);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now); oscillator.stop(now + 0.17);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch {
      soundOn = false; write('sound', '0'); updateSound();
      showToast('Sound is unavailable in this browser. Keep on merging.');
    }
  }
  function move(direction) {
    if (checkDate()) return;
    if (!$('board-overlay').hidden || document.querySelector('dialog[open]') || !menu.hidden) return;
    if (busy) { if (queue.length < 2) queue.push(direction); return; }
    const previous = snapshot();
    const result = E.play(state, direction);
    clearHint();
    if (!result.changed) {
      $('board-message').textContent = 'That way’s full. Try another direction.';
      return;
    }
    history.push(previous);
    if (history.length > 32) history.shift();
    state = result.state;
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
      playTone(Math.max(...result.merges.map((tile) => tile.value)));
    }
    const finish = () => {
      if (token !== revision) return;
      renderTiles(result.merges, result.spawn);
      if (state.won && !previous.won) {
        celebrate();
        if (currentMode === 'zen') showToast('2048 club! There’s plenty of room to keep going.');
      }
      renderOverlay();
      $('game-announcer').textContent = 'Move ' + state.moves + '. Score ' + state.score + '. Top tile ' + E.highest(state.board) + '.' + (!E.canMove(state.board) ? ' No moves left. Try again or undo.' : state.won && !previous.won ? ' You reached 2048!' : '');
      busy = false;
      const next = queue.shift();
      if (next) move(next);
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
    if (!history.length || checkDate()) return;
    cancelAnimation();
    state = history.pop();
    clearHint();
    save(); renderAll();
    board.focus({ preventScroll: true });
    $('game-announcer').textContent = 'Move undone. Score ' + state.score + '. Move ' + state.moves + '.';
    showToast('One move back. Your personal best stays.');
  }
  function getHint() {
    if (busy || checkDate() || !$('board-overlay').hidden) return;
    const direction = E.hint(state.board);
    if (!direction) return;
    clearHint();
    $('board-message').textContent = 'A little nudge: try ' + arrows[direction] + ' ' + direction + '.';
    $('board-message').classList.add('has-hint');
    directions.find((button) => button.dataset.direction === direction).classList.add('is-hint');
    showToast('Try ' + arrows[direction] + ' ' + direction + '. A suggestion, no promises.');
    hintTimer = setTimeout(() => { clearHint(); renderInfo(); }, 6000);
  }
  function newGame() {
    cancelAnimation();
    state = E.createGame(currentMode, E.utcDate(), randomSeed());
    history = [];
    clearHint();
    save(); renderAll();
    board.focus({ preventScroll: true });
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
    if (soundOn) playTone(16);
    if (soundOn) showToast('Sound on. A little something for every merge.');
    else showToast('Sound off. Enjoy the quiet.');
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
    button.addEventListener('click', () => { if (button.dataset.mode !== currentMode) loadMode(button.dataset.mode); });
    button.addEventListener('keydown', (event) => {
      const index = modeButtons.indexOf(button);
      const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
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
  document.addEventListener('pointerdown', (event) => { if (!$('theme-picker').contains(event.target)) closeMenu(); });
  $('theme-picker').addEventListener('focusout', () => { setTimeout(() => { if (!$('theme-picker').contains(document.activeElement)) closeMenu(); }, 0); });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]') || document.querySelector('dialog[open]') || !menu.hidden) return;
    const key = event.key.toLowerCase();
    const direction = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[key];
    if (direction) { event.preventDefault(); move(direction); }
    else if (key === 'u' || key === 'h' || key === 'r' || key === '?') {
      event.preventDefault();
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
    if (document.hidden) { save(); if (busy) { cancelAnimation(); renderAll(); } }
    else checkDate();
  });
  window.addEventListener('pageshow', () => checkDate());

  updateThemeUI(); updateSound(); loadMode(currentMode);
})();
