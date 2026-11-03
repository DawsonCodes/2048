/* AppWatch's first-paint theme resolution, adapted to independent 2048 storage. */
(function () {
  'use strict';
  let theme = null;
  let reduced = false;
  try {
    const saved = localStorage.getItem('2048-remix:theme');
    if (['gray-dark', 'light', 'ms-paint'].includes(saved)) theme = saved;
    reduced = localStorage.getItem('2048-remix:less-motion') === '1';
  } catch { /* Play normally when storage is unavailable. */ }
  if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'gray-dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.lessMotion = String(reduced);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { 'gray-dark': '#131518', light: '#f5f6f8', 'ms-paint': '#c0c0c0' }[theme];
})();
