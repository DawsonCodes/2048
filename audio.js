/* Kenney CC0 sample playback. No generated tones or third-party requests. */
(function () {
  'use strict';
  const files = {
    slide: 'click_001.wav', merge: 'drop_001.wav', milestone: 'pluck_001.wav',
    undo: 'back_001.wav', hint: 'open_001.wav', confirm: 'confirmation_001.wav'
  };
  const levels = { slide: 0.24, merge: 0.42, milestone: 0.38, undo: 0.35, hint: 0.28, confirm: 0.35 };
  let enabled = false;
  let context;
  let output;
  let loading;
  let failed = false;
  const buffers = new Map();
  const active = new Set();

  function prepare() {
    if (failed) return Promise.resolve(false);
    try {
      if (!context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('Audio is unavailable');
        context = new AudioContext({ latencyHint: 'interactive' });
        output = context.createGain();
        output.gain.value = 0.65;
        output.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
      if (!loading) {
        loading = Promise.allSettled(Object.entries(files).map(async ([name, filename]) => {
          const response = await fetch('assets/audio/' + filename);
          if (!response.ok) throw new Error('Could not load sound: ' + name);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          buffers.set(name, buffer);
        })).then(() => {
          if (!buffers.size) throw new Error('No sounds could be decoded');
          return true;
        }).catch(() => { failed = true; return false; });
      }
      return loading;
    } catch { failed = true; return Promise.resolve(false); }
  }

  async function play(name, tile = 4) {
    if (!enabled || failed) return false;
    const ready = await prepare();
    if (!ready || !enabled || !buffers.has(name)) return false;
    try {
      if (active.size >= 8) {
        const oldest = active.values().next().value;
        oldest.stop();
        active.delete(oldest);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffers.get(name);
      source.playbackRate.value = name === 'merge' ? Math.min(1.3, 0.96 + Math.log2(tile) * 0.025) : 1;
      gain.gain.value = levels[name] || 0.3;
      source.connect(gain); gain.connect(output);
      active.add(source);
      source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
      return true;
    } catch { return false; }
  }

  function setEnabled(on) {
    enabled = on;
    if (on && failed) { failed = false; loading = undefined; buffers.clear(); }
    if (on) return prepare();
    for (const source of active) { try { source.stop(); } catch { /* Already finished. */ } }
    active.clear();
    return Promise.resolve(true);
  }

  window.RemixAudio = Object.freeze({ play, setEnabled });
})();
