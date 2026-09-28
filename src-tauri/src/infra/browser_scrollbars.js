// Each native frame has its own document and cannot inherit the shell's CSS.
// Reuse its scrollbar token and paint, without changing overflow or scroll offsets.
(() => {
  const id = 'misty-browser-scrollbars';
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
  install();
  // WebView initialization can run before <html> exists. The parsed document
  // also gets a fresh installation if a site replaced the initial head.
  document.addEventListener('DOMContentLoaded', install, { once: true });
})();
