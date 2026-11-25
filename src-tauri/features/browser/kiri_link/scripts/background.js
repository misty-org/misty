if (window === window.top) {
  let backgroundTimer = 0;
  let lastBackground = '';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let loaded = false;
  const stylesPending = () => Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))
    .some(link => !link.sheet && !link.disabled);
  const canvasColor = () => {
    const declared = getComputedStyle(document.documentElement).colorScheme || '';
    const meta = document.querySelector('meta[name="color-scheme"]')?.content || '';
    const scheme = declared && declared !== 'normal' ? declared : meta;
    const dark = /\bdark\b/.test(scheme)
      && (!/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? '#1e1e1e' : '#ffffff';
  };
  const clear = color => color === 'transparent' || /^rgba\((?:[^,]*,){3}\s*0\)$/.test(color);
  const bare = () => clear(getComputedStyle(document.documentElement).backgroundColor)
    && clear(getComputedStyle(document.body).backgroundColor);
  const reportBackground = () => {
    backgroundTimer = 0;
    if (!context || !document.body) return;
    if (!loaded && stylesPending()) return;
    context.globalAlpha = 1;
    context.fillStyle = canvasColor();
    context.fillRect(0, 0, 1, 1);
    const stack = document.elementsFromPoint(Math.max(0, innerWidth - 24), innerHeight / 2);
    for (const element of stack.reverse()) {
      if (element.closest('#misty-native-companion')) continue;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const channels = context.getImageData(0, 0, 1, 1).data;
    const background = '#' + Array.from(channels.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('');
    const canvasOnly = background === canvasColor() && bare();
    const report = background + (canvasOnly ? ' bare' : '');
    if (report === lastBackground) return;
    if (!sendToHost('{"token":"' + shortcutToken + '","background":"' + background + '","bare":' + canvasOnly + '}')) return;
    lastBackground = report;
  };
  const scheduleBackground = () => {
    clearTimeout(backgroundTimer);
    backgroundTimer = setTimeout(reportBackground, 150);
  };
  window.__MISTY_REPORT_BACKGROUND__ = scheduleBackground;
  new MutationObserver(scheduleBackground).observe(document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'data-theme', 'data-color-mode'],
  });
  if (document.documentElement) {
    new MutationObserver(scheduleBackground).observe(document.documentElement, {
      attributes: true, attributeFilter: ['style'],
    });
  }
  if (document.body) {
    new MutationObserver(scheduleBackground).observe(document.body, {
      attributes: true, attributeFilter: ['style'],
    });
  }
  addEventListener('DOMContentLoaded', scheduleBackground);
  addEventListener('load', () => {
    loaded = true;
    scheduleBackground();
  });
  const sheetSettled = event => {
    if (event.target instanceof HTMLLinkElement) scheduleBackground();
  };
  document.addEventListener('load', sheetSettled, true);
  document.addEventListener('error', sheetSettled, true);
  addEventListener('scroll', scheduleBackground, { passive: true });
  addEventListener('resize', scheduleBackground);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleBackground);
  scheduleBackground();
}
