(() => {
  const key = Symbol.for("misty.console");
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const LIMIT = 300;
  const kept = [];
  let next = 0;
  const text = (value) => {
    try {
      if (typeof value === "string") return value;
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const keep = (level, parts, location) => {
    kept.push({
      id: ++next,
      level,
      text: Array.from(parts, text).join(" ").slice(0, 2000),
      ...(location ? { location } : {}),
    });
    if (kept.length > LIMIT) kept.shift();
  };
  const levels = { log: "info", info: "info", warn: "warning", error: "error", debug: "debug" };
  for (const [method, level] of Object.entries(levels)) {
    const original = console[method];
    if (typeof original !== "function") continue;
    console[method] = function (...args) {
      keep(level, args);
      return original.apply(this, args);
    };
  }
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && target !== window && target.nodeType === 1) {
      const source = target.currentSrc || target.src || target.href || "";
      keep("error", [`Failed to load ${target.tagName.toLowerCase()} ${source}`.trim()]);
      return;
    }
    keep("error", [event.message || "Script error"], event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined);
  }, true);
  window.addEventListener("unhandledrejection", (event) => keep("error", ["Unhandled rejection:", event.reason]));
  document.addEventListener("misty:console-ask", () => {
    document.dispatchEvent(new CustomEvent("misty:console", { detail: JSON.stringify(kept) }));
  });
  document.addEventListener("misty:console-clear", () => { kept.length = 0; });
})();
