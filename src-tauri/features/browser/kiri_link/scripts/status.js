(() => {
  if (window.top !== window || window.__MISTY_SET_STATUS__) return;
  const statusToken = __MISTY_STATUS_TOKEN_PLACEHOLDER__;
  const bindHost = __KIRI_HOST_SENDER_PLACEHOLDER__;
  let postToHost = bindHost();
  const reportStopped = () => {
    postToHost = postToHost || bindHost();
    if (postToHost) postToHost('{"token":"' + statusToken + '","status":"stopped"}');
  };
  let reportedHref = String(location);
  const encode = encodeURIComponent;
  const reportLocation = () => {
    const href = String(location);
    if (href === reportedHref) return;
    reportedHref = href;
    postToHost = postToHost || bindHost();
    if (!postToHost) return;
    const encoded = encode(href);
    postToHost('{"token":"' + statusToken + '","status":"location"'
      + (encoded.length <= 800 ? ',"url":"' + encoded + '"' : "") + '}');
  };
  const historyProto = window.History && History.prototype;
  for (const name of ["pushState", "replaceState"]) {
    const original = historyProto && historyProto[name];
    if (typeof original !== "function") continue;
    historyProto[name] = function (...args) {
      const result = original.apply(this, args);
      setTimeout(reportLocation, 0);
      return result;
    };
  }
  window.addEventListener("popstate", () => setTimeout(reportLocation, 0), true);
  window.addEventListener("hashchange", reportLocation, true);
  window.addEventListener("pageshow", () => {
    reportedHref = String(location);
  });
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

  const fit = (text) => {
    const limit = Math.max(24, Math.floor(Math.min(innerWidth * 0.66, 720) / 6.6));
    if (text.length <= limit) return text;
    const head = Math.ceil((limit - 1) * 0.6);
    return `${text.slice(0, head)}…${text.slice(text.length - (limit - 1 - head))}`;
  };

  const text = () => {
    if (document.fullscreenElement) return "";
    if (link) return fit(link);
    return loading ? `Loading ${location.hostname || "page"}…` : "";
  };

  let cachedWidth = 0;
  let cachedHeight = 0;

  const place = () => {
    if (!label) return;
    const height = cachedHeight || 22;
    const width = cachedWidth || 120;
    const covered = pointer.y >= innerHeight - Math.max(height, 22) - 8
      && pointer.x >= 0 && pointer.x <= width + 8;
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
      cachedWidth = 0;
      cachedHeight = 0;
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
      const rect = label.getBoundingClientRect();
      cachedWidth = rect.width;
      cachedHeight = rect.height;
      place();
      label.classList.add("visible");
    };
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
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.key !== "Escape" || !loading) return;
    window.stop();
    loading = false;
    render();
    reportStopped();
  }, true);
  document.addEventListener("fullscreenchange", render);
  window.addEventListener("blur", () => setLink(""));
  const reportLoaded = () => {
    postToHost = postToHost || bindHost();
    if (postToHost) postToHost('{"token":"' + statusToken + '","status":"loaded"}');
  };
  window.addEventListener("load", () => {
    loading = false;
    render();
    reportLoaded();
  });
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (!loading) return;
      loading = false;
      render();
      reportLoaded();
    }, 4000);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reportLoaded();
  });
  window.addEventListener("pagehide", () => {
    link = "";
    loading = false;
    render();
  });

  window.__MISTY_SET_STATUS__ = (state) => {
    if (!state || typeof state !== "object") return;
    if (typeof state.loading === "boolean") loading = state.loading;
    render();
  };

  render();
})();
