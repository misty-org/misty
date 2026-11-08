// SPDX-License-Identifier: MIT
// A content script in the page's own world, as early as it can ask to run: did the embedder's
// script get there first, as Misty's per-tab token relies on?
document.documentElement.dataset.mainWorldSawSecret = typeof window.__PROBE_PAGE_SECRET__;
