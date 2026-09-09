// Installed at document start in every macOS webview and frame, independently
// of page capture. A loading/unsupported page must not fall back to WebKit's menu.
(() => {
  const label = window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label;
  const browserOrFrame = !label || label.startsWith('misty-browser-');
  // Browser pages and subframes are suppressed before website handlers run.
  // Shell/app handlers run first: Radix checks defaultPrevented before opening
  // its custom menus, so cancel the shell fallback during bubbling instead.
  window.addEventListener('contextmenu', event => event.preventDefault(), {
    capture: browserOrFrame,
  });
})();
