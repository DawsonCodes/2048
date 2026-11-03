/* Quiet, filtered Kenney CC0 samples, loaded from this site only. */
(function () {
  'use strict';
  const files = {
    merge: 'select_007.wav', milestone: 'select_008.wav',
    undo: 'click_005.wav', hint: 'tick_002.wav', confirm: 'bong_001.wav'
  };
  const levels = { merge: 0.5, milestone: 0.5, undo: 0.3, hint: 0.25, confirm: 0.3 };
  let volume = 0.25, lastMerge = -Infinity;
  let enabled = false;
  let context;
  let output;
  let tone;
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
        output.gain.value = volume * 0.6;
        tone = context.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200; tone.Q.value = 0.6;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -12; limiter.knee.value = 12; limiter.ratio.value = 8;
        limiter.attack.value = 0.003; limiter.release.value = 0.1;
        tone.connect(limiter); limiter.connect(output);
        output.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
      if (!loading) {
        loading = Promise.allSettled(Object.entries(files).map(async ([name, filename]) => {
          const response = await fetch('assets/audio/' + filename);
          if (!response.ok) throw new Error('Could not load sound: ' + name);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          let peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
          }
          buffers.set(name, { buffer, normalization: peak > 0 ? 0.8 / peak : 0 });
        })).then(() => {
          if (!buffers.size) throw new Error('No sounds could be decoded');
          return true;
        }).catch(() => { failed = true; return false; });
      }
      return loading;
    } catch { failed = true; return Promise.resolve(false); }
  }

  async function play(name, tile = 4) {
    if (failed) return false;
    if (!enabled || !files[name] || volume === 0) return true;
    const merge = name === 'merge' || name === 'milestone';
    if (merge && performance.now() - lastMerge < 170) return true;
    if (merge) lastMerge = performance.now();
    const ready = await prepare();
    if (!ready || !enabled || !buffers.has(name)) return false;
    try {
      if (active.size >= 2) {
        const oldest = active.values().next().value;
        oldest.stop();
        active.delete(oldest);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      const sample = buffers.get(name);
      source.buffer = sample.buffer;
      source.playbackRate.value = merge ? Math.min(1.02, 0.8 + Math.log2(tile) * 0.016) : 0.85;
      const now = context.currentTime, duration = source.buffer.duration / source.playbackRate.value;
      const level = levels[name] * sample.normalization;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + Math.min(0.005, duration * 0.2));
      gain.gain.setValueAtTime(level, now + duration - Math.min(0.035, duration * 0.4));
      gain.gain.linearRampToValueAtTime(0, now + duration);
      source.connect(gain); gain.connect(tone);
      active.add(source);
      source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
      return true;
    } catch { return false; }
  }

  function setVolume(value) {
    volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.25;
    if (output) output.gain.setTargetAtTime(volume * 0.6, context.currentTime, 0.025);
  }

  function setEnabled(on) {
    enabled = on;
    if (on && failed) { failed = false; loading = undefined; buffers.clear(); }
    if (on) return prepare();
    for (const source of active) { try { source.stop(); } catch { /* Already finished. */ } }
    active.clear();
    return Promise.resolve(true);
  }

  window.RemixAudio = Object.freeze({ play, setEnabled, setVolume });
})();
