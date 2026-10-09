// Each native frame has its own document and cannot inherit the shell's CSS.
// Reuse its scrollbar token and paint, without changing overflow or scroll offsets.
(() => {
  const id = 'misty-browser-scrollbars';
  const rootId = 'misty-browser-root-scrollbar';
  const css = __MISTY_SCROLLBAR_CSS_PLACEHOLDER__;
  const install = () => {
    if (document.getElementById(id)) return;
    const root = document.head || document.documentElement;
    if (!root) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    root.appendChild(style);
  };

  // WebKit paints a transparent page-scrollbar track with its own gray, not
  // the page, and a site's unlayered `scrollbar-color` (YouTube sets one on
  // <html>) switches the page scrollbar back to that native paint. Keep the
  // page scrollbar on the styled path and fill its track with the page's
  // canvas colour. Sites that hide it with `scrollbar-width: none` keep that.
  const transparent = (color) =>
    !color || color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color);
  let rootTimer = 0;
  let lastRootCss = null;
  const syncRoot = () => {
    rootTimer = 0;
    const html = document.documentElement;
    if (!html) return;
    let style = document.getElementById(rootId);
    // Read the page's own values, not the override from the previous pass.
    if (style) style.disabled = true;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const hidden = [htmlStyle, bodyStyle].some((s) => s && s.scrollbarWidth === 'none');
    const canvas = [htmlStyle, bodyStyle]
      .map((s) => s && s.backgroundColor)
      // A frame without a background shows its embedder through it.
      .find((color) => !transparent(color)) || (window === window.top ? 'Canvas' : 'transparent');
    if (style) style.disabled = false;
    const next = hidden
      ? ''
      : `html, body { scrollbar-color: auto !important; scrollbar-width: auto !important; }
html::-webkit-scrollbar-track, body::-webkit-scrollbar-track,
html::-webkit-scrollbar-corner, body::-webkit-scrollbar-corner { background: ${canvas}; }`;
    if (next === lastRootCss && style) return;
    if (!style) {
      const parent = document.head || html;
      style = document.createElement('style');
      style.id = rootId;
      parent.appendChild(style);
    }
    style.textContent = next;
    lastRootCss = next;
  };
  const scheduleRoot = () => {
    if (rootTimer) return;
    rootTimer = setTimeout(syncRoot, 100);
  };

  install();
  syncRoot();
  // WebView initialization can run before <html> exists. The parsed document
  // also gets a fresh installation if a site replaced the initial head.
  document.addEventListener('DOMContentLoaded', () => {
    install();
    scheduleRoot();
    // Theme switches usually flip an attribute or class on <html> or <body>.
    for (const element of [document.documentElement, document.body]) {
      if (element) new MutationObserver(scheduleRoot).observe(element, { attributes: true });
    }
  }, { once: true });
  addEventListener('load', scheduleRoot);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleRoot);
})();
