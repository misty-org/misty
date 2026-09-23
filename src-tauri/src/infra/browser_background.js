// Report only a solid background color; never send page content or pixels.
if (window === window.top) {
  let backgroundTimer = 0;
  let lastBackground = '';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const reportBackground = () => {
    backgroundTimer = 0;
    if (!context || !document.body) return;
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 1, 1);
    const stack = document.elementsFromPoint(Math.max(0, innerWidth - 24), innerHeight / 2);
    for (const element of stack.reverse()) {
      if (element.closest('#misty-native-companion')) continue;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const channels = context.getImageData(0, 0, 1, 1).data;
    const background = '#' + Array.from(channels.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('');
    const channel = window.webkit?.messageHandlers?.mistyFocus;
    if (background === lastBackground || !channel) return;
    channel.postMessage(JSON.stringify({ token: shortcutToken, background }));
    lastBackground = background;
  };
  const scheduleBackground = () => {
    clearTimeout(backgroundTimer);
    backgroundTimer = setTimeout(reportBackground, 150);
  };
  window.__MISTY_REPORT_BACKGROUND__ = scheduleBackground;
  new MutationObserver(scheduleBackground).observe(document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-theme', 'data-color-mode'],
  });
  addEventListener('DOMContentLoaded', scheduleBackground);
  addEventListener('load', scheduleBackground);
  addEventListener('scroll', scheduleBackground, { passive: true });
  addEventListener('resize', scheduleBackground);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleBackground);
  scheduleBackground();
}
