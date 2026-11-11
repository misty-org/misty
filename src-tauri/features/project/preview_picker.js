// The element picker Misty runs in a preview page (preview.rs). It is evaluated in the person's
// own local app, changes nothing there that outlives the pick, and reports through
// `window.__MISTY_PREVIEW_PICKED__`: a JSON string for a picked element, "" for a cancelled pick.
// It also keeps the page's last few errors, from the moment it is first installed.
(() => {
  if (window.__MISTY_PREVIEW__) return;
  const HTML_LIMIT = 4096;
  const errors = [];
  const note = (text) => {
    const line = String(text).replace(/\s+/g, " ").trim().slice(0, 400);
    if (!line) return;
    errors.push(line);
    if (errors.length > 20) errors.shift();
  };
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        note(`Failed to load ${target.src || target.href}`);
      } else if (event.message) {
        const where = event.filename ? ` (${event.filename}:${event.lineno})` : "";
        note(event.message + where);
      }
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    note(`Unhandled rejection: ${(reason && reason.message) || reason}`);
  });
  const consoleError = console.error;
  console.error = function (...args) {
    try {
      note(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
    } catch (_) {
      // A value that cannot be turned into text is not worth breaking the page's own logging.
    }
    return consoleError.apply(this, args);
  };

  const escape = (value) =>
    window.CSS && CSS.escape
      ? CSS.escape(value)
      : String(value).replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (c) => `\\${c}`).replace(/^(-?\d)/, "\\3$1 ");
  const count = (selector, root) => {
    try {
      return root.querySelectorAll(selector).length;
    } catch (_) {
      return 0;
    }
  };
  // Class names a build generates (hashes, long utility strings) change between builds.
  const stableClasses = (element) =>
    [...element.classList]
      .filter((name) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name) && name.length <= 32)
      .filter((name) => !/^(css|sc|jsx|svelte|emotion)-|\d{3,}|\d.*[a-zA-Z].*\d|__[a-zA-Z0-9]{5,}$/.test(name))
      .slice(0, 2);
  const step = (element) => {
    const tag = element.localName;
    const parent = element.parentElement;
    let part = tag + stableClasses(element).map((name) => `.${escape(name)}`).join("");
    if (!parent) return part;
    const twins = [...parent.children].filter((child) => {
      try {
        return child.matches(part);
      } catch (_) {
        return false;
      }
    });
    if (twins.length > 1) {
      const sameTag = [...parent.children].filter((child) => child.localName === tag);
      part = `${part}:nth-of-type(${sameTag.indexOf(element) + 1})`;
    }
    return part;
  };
  /** A selector that finds only this element: an id or test id where one is unique, else a path. */
  const selector = (element) => {
    const root = element.ownerDocument;
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node === root.documentElement) {
        parts.unshift("html");
        break;
      }
      if (node === root.body) {
        parts.unshift("body");
        break;
      }
      const anchors = [];
      if (node.id) anchors.push(`#${escape(node.id)}`);
      const testId = node.getAttribute("data-testid");
      if (testId) anchors.push(`[data-testid="${testId.replace(/["\\]/g, "\\$&")}"]`);
      const anchor = anchors.find((candidate) => count(candidate, root) === 1);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
      parts.unshift(step(node));
      // A bare tag that happens to be alone on the page says little, so it keeps its parent.
      const bare = parts.length === 1 && /^[a-z0-9-]+$/.test(parts[0]);
      if (!bare && count(parts.join(" > "), root) === 1) break;
    }
    return parts.join(" > ");
  };

  const px = (value) => Math.round(value * 10) / 10;
  /** What Misty tells the agent about an element. */
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const html = element.outerHTML || "";
    return {
      url: location.href,
      selector: selector(element),
      tag: element.localName,
      id: element.id || "",
      classes: [...element.classList].slice(0, 24),
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
      rect: { x: px(rect.x), y: px(rect.y), width: px(rect.width), height: px(rect.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      styles: {
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].join(" "),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(" "),
        color: style.color,
        background: style.backgroundColor,
        font: [style.fontWeight, `${style.fontSize}/${style.lineHeight}`, style.fontFamily].join(" "),
      },
      html: html.length > HTML_LIMIT ? `${html.slice(0, HTML_LIMIT)}…` : html,
      htmlTruncated: html.length > HTML_LIMIT,
      errors: errors.slice(-8),
    };
  };

  let stop = null;
  const cancel = () => {
    if (stop) stop("");
  };
  /** Starts a pick: the element under the pointer is outlined, a click reports it, Escape cancels. */
  const start = () => {
    cancel();
    window.__MISTY_PREVIEW_PICKED__ = undefined;
    const box = document.createElement("div");
    box.setAttribute("data-misty-preview-picker", "");
    box.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;display:none;" +
      "border:1.5px solid #4c8dff;background:rgba(76,141,255,.14);border-radius:2px;margin:0;padding:0;";
    const label = document.createElement("div");
    label.style.cssText =
      "position:absolute;left:-1.5px;bottom:100%;margin-bottom:3px;padding:2px 6px;border-radius:4px;white-space:nowrap;" +
      "background:#1f2937;color:#fff;font:500 11px/1.4 ui-monospace,Menlo,monospace;max-width:60vw;" +
      "overflow:hidden;text-overflow:ellipsis;";
    box.appendChild(label);
    const cursor = document.createElement("style");
    cursor.textContent = "*{cursor:crosshair !important}";
    document.documentElement.append(box, cursor);
    let current = null;
    const outline = () => {
      if (!current || !current.isConnected) {
        box.style.display = "none";
        return;
      }
      const rect = current.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.style.bottom = rect.top < 24 ? "auto" : "100%";
      label.style.top = rect.top < 24 ? "100%" : "auto";
      label.textContent = `${step(current).replace(/:nth-of-type\(\d+\)$/, "")}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    };
    const move = (event) => {
      const found = document.elementFromPoint(event.clientX, event.clientY);
      if (found && found !== current) {
        current = found;
        outline();
      }
    };
    const swallow = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const click = (event) => {
      swallow(event);
      if (!event.isTrusted) return;
      const found = document.elementFromPoint(event.clientX, event.clientY) || current;
      stop(found ? JSON.stringify(describe(found)) : "");
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      swallow(event);
      stop("");
    };
    const pressed = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu"];
    window.addEventListener("mousemove", move, true);
    window.addEventListener("scroll", outline, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    pressed.forEach((name) => window.addEventListener(name, swallow, true));
    stop = (result) => {
      stop = null;
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("scroll", outline, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      pressed.forEach((name) => window.removeEventListener(name, swallow, true));
      box.remove();
      cursor.remove();
      window.__MISTY_PREVIEW_PICKED__ = result;
    };
  };

  window.__MISTY_PREVIEW__ = { start, cancel, selector, describe, errors: () => errors.slice() };
})();
