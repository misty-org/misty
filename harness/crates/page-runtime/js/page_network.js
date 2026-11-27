// Misty page-world network counter: whether the page's own fetch and XMLHttpRequest calls are
// still in flight, for the agent runtime's settle (page_read.js), which lives in its own script
// world and cannot see page scripts. While any request younger than 1.5 s is open, the root
// element carries `data-misty-busy`; requests open longer (streams, long polls) stop counting.
//
// A host installs it at document start in the page's own world, and only where it chooses to:
// unlike the runtime, the page can see it. It misses workers, beacons and image and script
// loads; a host with a native resource-load signal should prefer that.
//
// It also keeps the page's recent requests (method, address, status, type, time) for
// `browser_network_requests`: fetch and XMLHttpRequest as they run, with their headers (sign-in
// headers hidden) and text bodies for the last 100, everything else from resource timing. The
// runtime asks for them with `misty:network-ask`.
(() => {
  const key = Symbol.for("misty.network");
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const YOUNG = 1500;
  const open = new Map();
  let next = 0;
  let timer = 0;
  const root = () => document.documentElement;
  const update = () => {
    const now = performance.now();
    let young = false;
    for (const started of open.values()) if (now - started < YOUNG) { young = true; break; }
    const el = root();
    if (el) {
      if (young && !el.hasAttribute("data-misty-busy")) el.setAttribute("data-misty-busy", "");
      if (!young && el.hasAttribute("data-misty-busy")) el.removeAttribute("data-misty-busy");
    }
    clearTimeout(timer);
    // Re-check while requests are open, so one that outlives 1.5 s stops counting.
    if (young) timer = setTimeout(update, 250);
  };
  const begin = () => { const id = ++next; open.set(id, performance.now()); update(); return id; };
  const end = (id) => { open.delete(id); update(); };

  const LOG_LIMIT = 500;
  const log = [];
  let logged = 0;
  const record = (entry) => {
    const kept = { id: ++logged, ...entry };
    log.push(kept);
    if (log.length > LOG_LIMIT) log.shift();
    return kept;
  };
  const address = (value) => {
    try { return new URL(String(value?.url ?? value), location.href).href; } catch { return String(value); }
  };
  const BODY_LIMIT = 20000;
  const DETAILED = 100;
  const HIDDEN = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
  const detailed = [];
  const detail = (entry, part) => {
    if (!entry.detail) {
      entry.detail = {};
      detailed.push(entry);
      if (detailed.length > DETAILED) delete detailed.shift().detail;
    }
    Object.assign(entry.detail, part);
  };
  const headersOf = (pairs) => {
    const out = {};
    for (const [name, value] of pairs) out[String(name).toLowerCase()] = HIDDEN.test(name) ? "[hidden]" : String(value).slice(0, 2000);
    return out;
  };
  const rawHeaders = (text) => headersOf(String(text || "").trim().split(/\r?\n/).filter(Boolean)
    .map((line) => { const at = line.indexOf(":"); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
  const readable = (type) => !type || /^text\/|json|xml|javascript|x-www-form-urlencoded|graphql/i.test(type);
  const clipBody = (text) => text.length > BODY_LIMIT ? { body: text.slice(0, BODY_LIMIT), bodyCut: text.length } : { body: text };
  const sentBody = (body) => {
    if (body == null) return undefined;
    if (typeof body === "string") return clipBody(body);
    if (body instanceof URLSearchParams) return clipBody(body.toString());
    if (typeof FormData === "function" && body instanceof FormData) {
      return clipBody([...body.entries()].map(([name, value]) => `${name}=${typeof value === "string" ? value : `[file ${value.name || ""}]`}`).join("&"));
    }
    return { body: `[${body?.constructor?.name || typeof body}]` };
  };
  const requestHeaders = (input, init) => {
    try {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      return headersOf(headers.entries());
    } catch { return {}; }
  };
  const xhrs = new WeakMap();
  const fetch = window.fetch;
  if (typeof fetch === "function") {
    window.fetch = function (...args) {
      const id = begin();
      const started = performance.now();
      const entry = record({
        type: "fetch",
        method: String(args[1]?.method || args[0]?.method || "GET").toUpperCase(),
        url: address(args[0]),
      });
      const sent = sentBody(args[1]?.body);
      detail(entry, { requestHeaders: requestHeaders(args[0], args[1]), ...(sent ? { requestBody: sent.body, ...(sent.bodyCut ? { requestBodyLength: sent.bodyCut } : {}) } : {}) });
      let pending;
      try { pending = fetch.apply(this, args); } catch (error) { end(id); entry.failed = String(error); throw error; }
      return Promise.resolve(pending).then((answer) => {
        entry.status = answer.status;
        entry.contentType = answer.headers.get("content-type") || undefined;
        entry.ms = Math.round(performance.now() - started);
        detail(entry, { responseHeaders: headersOf(answer.headers.entries()) });
        if (readable(entry.contentType)) {
          try {
            answer.clone().text().then((text) => {
              const got = clipBody(text);
              detail(entry, { responseBody: got.body, ...(got.bodyCut ? { responseBodyLength: got.bodyCut } : {}) });
            }, () => {});
          } catch {}
        }
        return answer;
      }, (error) => {
        entry.failed = String(error?.message || error);
        entry.ms = Math.round(performance.now() - started);
        throw error;
      }).finally(() => end(id));
    };
  }
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrs.set(this, { method: String(method || "GET").toUpperCase(), url: address(url), headers: [] });
    return xhrOpen.call(this, method, url, ...rest);
  };
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    xhrs.get(this)?.headers.push([name, value]);
    return setHeader.call(this, name, value);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const id = begin();
    const started = performance.now();
    const asked = xhrs.get(this) || { method: "GET", url: "", headers: [] };
    const entry = record({ type: "xhr", method: asked.method, url: asked.url });
    const sent = sentBody(args[0]);
    detail(entry, { requestHeaders: headersOf(asked.headers), ...(sent ? { requestBody: sent.body, ...(sent.bodyCut ? { requestBodyLength: sent.bodyCut } : {}) } : {}) });
    this.addEventListener("loadend", () => {
      entry.status = this.status || undefined;
      if (!this.status) entry.failed = "The request didn't complete.";
      entry.contentType = this.getResponseHeader?.("content-type") || undefined;
      entry.ms = Math.round(performance.now() - started);
      detail(entry, { responseHeaders: rawHeaders(this.getAllResponseHeaders?.()) });
      if (readable(entry.contentType) && (this.responseType === "" || this.responseType === "text")) {
        const got = clipBody(String(this.responseText ?? ""));
        detail(entry, { responseBody: got.body, ...(got.bodyCut ? { responseBodyLength: got.bodyCut } : {}) });
      }
      end(id);
    }, { once: true });
    try { return send.apply(this, args); } catch (error) { end(id); entry.failed = String(error); throw error; }
  };
  const resources = (list) => {
    for (const timing of list) {
      if (timing.initiatorType === "fetch" || timing.initiatorType === "xmlhttprequest") continue;
      record({
        type: timing.entryType === "navigation" ? "document" : timing.initiatorType || "other",
        method: "GET",
        url: timing.name,
        ...(timing.responseStatus ? { status: timing.responseStatus } : {}),
        ms: Math.round(timing.duration),
        ...(timing.transferSize ? { bytes: timing.transferSize } : {}),
      });
    }
  };
  try {
    new PerformanceObserver((list) => resources(list.getEntries())).observe({ type: "resource", buffered: true });
  } catch {}
  const navigation = () => resources(performance.getEntriesByType?.("navigation") || []);
  if (document.readyState === "complete") navigation();
  else window.addEventListener("load", navigation, { once: true });
  document.addEventListener("misty:network-ask", () => {
    document.dispatchEvent(new CustomEvent("misty:network", { detail: JSON.stringify(log) }));
  });
  document.addEventListener("misty:network-clear", () => { log.length = 0; detailed.length = 0; });
})();
