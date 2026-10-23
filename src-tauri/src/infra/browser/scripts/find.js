// Find in page. Highlights every match with the CSS Custom Highlight API and
// scrolls to the current one. Returns { current, total } (1-based current).
(() => {
  const query = __MISTY_FIND_QUERY__;
  const direction = __MISTY_FIND_DIRECTION__;
  const options = __MISTY_FIND_OPTIONS__;
  const state = window.__MISTY_FIND__ || (window.__MISTY_FIND__ = { query: "", key: "", ranges: [], index: -1 });
  const highlights = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  const clear = () => {
    highlights?.delete("misty-find");
    highlights?.delete("misty-find-current");
    state.query = "";
    state.key = "";
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
  const key = [options.matchCase, options.matchDiacritics, options.wholeWords].join();
  if (query !== state.query || key !== state.key || stale) {
    // Fold text the way the options ask, keeping where each folded character came from.
    const fold = (text) => {
      let folded = "";
      const map = [];
      for (let at = 0; at < text.length; at += 1) {
        let part = text[at];
        if (!options.matchCase) part = part.toLocaleLowerCase();
        if (!options.matchDiacritics) part = part.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        for (let i = 0; i < part.length; i += 1) map.push(at);
        folded += part;
      }
      return { folded, map };
    };
    const wordChar = /[\p{L}\p{N}_]/u;
    const needle = fold(query).folded;
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
      const { folded: text, map } = fold(node.nodeValue);
      for (let at = text.indexOf(needle); at !== -1 && ranges.length < 2000; at = text.indexOf(needle, at + needle.length)) {
        const end = at + needle.length;
        if (options.wholeWords && (wordChar.test(text[at - 1] || "") || wordChar.test(text[end] || ""))) continue;
        const range = document.createRange();
        range.setStart(node, map[at]);
        range.setEnd(node, map[end - 1] + 1);
        ranges.push(range);
      }
    }
    state.query = query;
    state.key = key;
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
    highlights.set("misty-find", new Highlight(...(options.highlightAll ? state.ranges : [])));
    highlights.set("misty-find-current", new Highlight(current));
  } else {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(current);
  }
  current.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
  return { current: state.index + 1, total };
})()
