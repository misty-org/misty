// Find in page. Highlights every match with the CSS Custom Highlight API and
// scrolls to the current one. Returns { current, total } (1-based current).
(() => {
  const query = __MISTY_FIND_QUERY__;
  const direction = __MISTY_FIND_DIRECTION__;
  const state = window.__MISTY_FIND__ || (window.__MISTY_FIND__ = { query: "", ranges: [], index: -1 });
  const highlights = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  const clear = () => {
    highlights?.delete("misty-find");
    highlights?.delete("misty-find-current");
    state.query = "";
    state.ranges = [];
    state.index = -1;
    return { current: 0, total: 0 };
  };
  if (direction === "clear" || !query) return clear();

  if (!state.sheet && highlights && "adoptedStyleSheets" in document) {
    // A constructed sheet is not blocked by a page's style-src policy.
    try {
      state.sheet = new CSSStyleSheet();
      state.sheet.replaceSync(
        "::highlight(misty-find){background-color:#fde68a;color:#111}" +
        "::highlight(misty-find-current){background-color:#f59e0b;color:#111}",
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, state.sheet];
    } catch (_) {}
  }

  const stale = state.ranges.some((range) => !range.startContainer.isConnected);
  if (query !== state.query || stale) {
    const needle = query.toLocaleLowerCase();
    const ranges = [];
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT"]);
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || skip.has(parent.tagName) || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.checkVisibility && !parent.checkVisibility()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node && ranges.length < 2000; node = walker.nextNode()) {
      const text = node.nodeValue.toLocaleLowerCase();
      for (let at = text.indexOf(needle); at !== -1 && ranges.length < 2000; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
    state.query = query;
    state.ranges = ranges;
    state.index = -1;
  }

  const total = state.ranges.length;
  if (!total) {
    highlights?.delete("misty-find");
    highlights?.delete("misty-find-current");
    return { current: 0, total: 0 };
  }
  state.index = direction === "previous"
    ? (state.index - 1 + total) % total
    : (state.index + 1) % total;
  const current = state.ranges[state.index];
  if (highlights && typeof Highlight !== "undefined") {
    highlights.set("misty-find", new Highlight(...state.ranges));
    highlights.set("misty-find-current", new Highlight(current));
  } else {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(current);
  }
  current.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
  return { current: state.index + 1, total };
})()
