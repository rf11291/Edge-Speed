(() => {
  'use strict';
  const button = document.getElementById('themeToggle');
  const saved = localStorage.getItem('open-edge-speed-theme');
  const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const icon = (isDark) => isDark
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78"/><circle cx="12" cy="12" r="4.25"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.6A7.6 7.6 0 0 1 9.4 3.8a8.2 8.2 0 1 0 10.8 10.8Z"/></svg>';
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    if (!button) return;
    const label = theme === 'dark' ? '切换为浅色主题' : '切换为深色主题';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.innerHTML = icon(theme === 'dark');
  };
  apply(saved === 'light' || saved === 'dark' ? saved : preferred);
  if (button) {
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('open-edge-speed-theme', next);
      apply(next);
    });
  }
})();
