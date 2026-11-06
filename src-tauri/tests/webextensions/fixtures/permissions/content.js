// SPDX-License-Identifier: MIT
// A content script looks for what Misty keeps in the page's own world.
document.documentElement.dataset.mistyPermissions = JSON.stringify({
  handler: typeof window.webkit?.messageHandlers?.probeHost,
  pageSecret: typeof window.__PROBE_PAGE_SECRET__,
  tauri: typeof window.__TAURI_INTERNALS__,
});
