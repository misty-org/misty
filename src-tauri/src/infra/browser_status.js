// Chrome-style status bubble: shows the hovered link, or that the page is
// still loading, in the page's bottom-left corner. It is drawn inside the page
// because DOM in Misty's renderer cannot sit above a native WebView.
(() => {
  if (window.top !== window || window.__MISTY_SET_STATUS__) return;
  let enabled = __MISTY_STATUS_ENABLED_PLACEHOLDER__;
  let loading = /^https?:$/.test(location.protocol) && document.readyState !== "complete";
  let link = "";
  let host = null;
  let label = null;
  let shown = "";
  let onRight = false;
  let showTimer = 0;
  let hideTimer = 0;
  let pointer = { x: -1, y: -1 };

  const css = `
    :host { all: initial; }
    div {
      position: fixed; bottom: 0; left: 0; max-width: min(66vw, 720px);
      box-sizing: border-box; padding: 3px 8px; overflow: hidden;
      white-space: nowrap; text-overflow: ellipsis;
      font: 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124; background: #f1f3f4; border: 1px solid #dadce0;
      border-left: 0; border-bottom: 0; border-top-right-radius: 4px;
      opacity: 0; transition: opacity 120ms ease-out;
    }
    div.right { left: auto; right: 0; border-left: 1px solid #dadce0; border-right: 0;
      border-top-right-radius: 0; border-top-left-radius: 4px; }
    div.visible { opacity: 1; }
    @media (prefers-color-scheme: dark) {
      div { color: #e8eaed; background: #292a2d; border-color: #3c4043; }
    }
    @media (prefers-reduced-motion: reduce) { div { transition: none; } }
  `;

  const ensureHost = () => {
    if (host?.isConnected) return true;
    const root = document.documentElement;
    if (!root) return false;
    host = document.createElement("misty-status-bubble");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all:initial;position:fixed;inset:auto;pointer-events:none;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    label = document.createElement("div");
    // A constructed sheet is not blocked by a page's style-src policy.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch (_) {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.append(style);
    }
    shadow.append(label);
    root.append(host);
    return true;
  };

  // Keep both ends of a long address readable, as Chrome does.
  const fit = (text) => {
    const limit = Math.max(24, Math.floor(Math.min(innerWidth * 0.66, 720) / 6.6));
    if (text.length <= limit) return text;
    const head = Math.ceil((limit - 1) * 0.6);
    return `${text.slice(0, head)}…${text.slice(text.length - (limit - 1 - head))}`;
  };

  const text = () => {
    if (!enabled || document.fullscreenElement) return "";
    if (link) return fit(link);
    return loading ? `Loading ${location.hostname || "page"}…` : "";
  };

  const place = () => {
    if (!label) return;
    // Step aside when the pointer is over the bubble's corner.
    const rect = label.getBoundingClientRect();
    const covered = pointer.y >= innerHeight - Math.max(rect.height, 22) - 8
      && pointer.x >= 0 && pointer.x <= rect.width + 8;
    if (covered !== onRight) {
      onRight = covered;
      label.classList.toggle("right", onRight);
    }
  };

  const render = () => {
    const next = text();
    if (next === shown) return;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (!next) {
      // A short grace period stops flicker when moving between adjacent links.
      hideTimer = setTimeout(() => {
        shown = "";
        label?.classList.remove("visible");
      }, 150);
      return;
    }
    const reveal = () => {
      if (!ensureHost()) {
        showTimer = setTimeout(reveal, 50);
        return;
      }
      shown = next;
      label.textContent = next;
      place();
      label.classList.add("visible");
    };
    // Loading and an already-visible bubble update at once; a fresh hover
    // waits briefly so a pointer passing across the page does not flash it.
    if (shown || !link) reveal();
    else showTimer = setTimeout(reveal, 80);
  };

  const linkFor = (target) => {
    const anchor = target?.closest?.("a[href], area[href]");
    if (!anchor) return "";
    const href = anchor.getAttribute("href") || "";
    if (!href || /^\s*javascript:/i.test(href)) return "";
    try {
      return decodeURI(new URL(href, location.href).href);
    } catch (_) {
      return anchor.href || "";
    }
  };

  const setLink = (value) => {
    if (value === link) return;
    link = value;
    render();
  };

  document.addEventListener("pointerover", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    setLink(linkFor(event.target));
  }, true);
  document.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (shown) place();
  }, { capture: true, passive: true });
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) setLink("");
  }, true);
  document.addEventListener("focusin", (event) => setLink(linkFor(event.target)), true);
  document.addEventListener("focusout", () => setLink(""), true);
  // Escape stops a page that is still loading, as in Chrome and Safari. The
  // page still receives the key; only the load is cancelled.
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.key !== "Escape" || !loading) return;
    window.stop();
    loading = false;
    render();
    window.location.href = "misty-status:stopped";
  }, true);
  document.addEventListener("fullscreenchange", render);
  window.addEventListener("blur", () => setLink(""));
  window.addEventListener("load", () => {
    loading = false;
    render();
  });
  window.addEventListener("pagehide", () => {
    link = "";
    loading = false;
    render();
  });

  // Native pushes load phases and the user's preference.
  window.__MISTY_SET_STATUS__ = (state) => {
    if (!state || typeof state !== "object") return;
    if (typeof state.enabled === "boolean") enabled = state.enabled;
    if (typeof state.loading === "boolean") loading = state.loading;
    render();
  };

  render();
})();
