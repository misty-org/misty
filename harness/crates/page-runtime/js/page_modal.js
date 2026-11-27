((P) => {
  const ACTING = "data-misty-acting";
  const ARMED = "data-misty-dialog-answer";
  const SEEN = "data-misty-dialog";
  const root = () => document.documentElement;

  P.acting = (args) => {
    const el = root();
    if (!el) return { ok: true };
    if (args.on) {
      el.setAttribute(ACTING, "");
      el.removeAttribute(SEEN);
      if (args.hold) el.setAttribute("data-misty-dialog-hold", "");
      else el.removeAttribute("data-misty-dialog-hold");
    } else {
      el.removeAttribute(ACTING);
      el.removeAttribute(ARMED);
      el.removeAttribute("data-misty-dialog-hold");
    }
    return { ok: true };
  };

  P.armDialog = (args) => {
    const el = root();
    if (!el) return { ok: false, attempted: false, error: "The page has no document yet." };
    el.setAttribute(ARMED, JSON.stringify({ accept: args.accept === true, ...(typeof args.text === "string" ? { text: args.text } : {}) }));
    return { ok: true, attempted: false, armed: true };
  };

  P.dialogSeen = () => {
    const el = root();
    const raw = el?.getAttribute(SEEN);
    el?.removeAttribute(SEEN);
    let dialog = null;
    try { dialog = raw ? JSON.parse(raw) : null; } catch { dialog = null; }
    const chooser = document.querySelector("[data-misty-file-chooser]");
    chooser?.removeAttribute("data-misty-file-chooser");
    return { ok: true, dialog, ...(chooser ? { fileChooser: P.register(chooser) } : {}) };
  };

  const RANK = { debug: 0, info: 1, warning: 2, error: 3 };

  P.console = (args) => {
    let entries = null;
    const take = (event) => {
      try { entries = JSON.parse(String(event.detail || "[]")); } catch { entries = []; }
    };
    document.addEventListener("misty:console", take);
    document.dispatchEvent(new CustomEvent("misty:console-ask"));
    document.removeEventListener("misty:console", take);
    if (!Array.isArray(entries)) return { ok: true, watched: false, last: 0, messages: [] };
    const since = Number(args.since) || 0;
    const least = RANK[args.level] ?? RANK.info;
    const messages = entries.filter((entry) => entry.id > since && (RANK[entry.level] ?? 1) >= least);
    const most = Math.max(1, Math.min(500, Number(args.limit) || 200));
    return {
      ok: true,
      watched: true,
      last: entries.length ? entries[entries.length - 1].id : since,
      messages: messages.slice(-most).map(({ level, text, location }) => ({ level, text, ...(location ? { location } : {}) })),
      ...(messages.length > most ? { omitted: messages.length - most } : {}),
    };
  };

  const STATIC = new Set(["img", "image", "css", "link", "script", "font", "icon", "video", "audio", "track", "beacon"]);

  P.networkLog = () => {
    let entries = null;
    const take = (event) => {
      try { entries = JSON.parse(String(event.detail || "[]")); } catch { entries = []; }
    };
    document.addEventListener("misty:network", take);
    document.dispatchEvent(new CustomEvent("misty:network-ask"));
    document.removeEventListener("misty:network", take);
    return Array.isArray(entries) ? entries : null;
  };

  P.network = (args) => {
    let entries = null;
    const take = (event) => {
      try { entries = JSON.parse(String(event.detail || "[]")); } catch { entries = []; }
    };
    document.addEventListener("misty:network", take);
    document.dispatchEvent(new CustomEvent("misty:network-ask"));
    document.removeEventListener("misty:network", take);
    if (!Array.isArray(entries)) return { ok: true, watched: false, requests: [] };
    const since = Number(args.since) || 0;
    const filter = typeof args.filter === "string" && args.filter ? args.filter.toLowerCase() : "";
    const shown = entries.filter((entry) => entry.id > since
      && (args.includeStatic === true || !STATIC.has(entry.type))
      && (!filter || entry.url.toLowerCase().includes(filter)));
    const most = Math.max(1, Math.min(500, Number(args.limit) || 100));
    return {
      ok: true,
      watched: true,
      last: entries.length ? entries[entries.length - 1].id : since,
      requests: shown.slice(-most).map(({ detail, ...entry }) => ({ ...entry, url: P.clip(entry.url, 400), ...(detail ? { detailed: true } : {}) })),
      ...(shown.length > most ? { omitted: shown.length - most } : {}),
    };
  };

  P.storage = (args) => {
    let store;
    try {
      store = args.store === "session" ? window.sessionStorage : window.localStorage;
    } catch {
      return { ok: false, code: "storage_unavailable", message: "This page can't keep storage." };
    }
    if (!store) return { ok: false, code: "storage_unavailable", message: "This page can't keep storage." };
    const name = typeof args.name === "string" ? args.name : "";
    const action = args.action || "list";
    const named = () => {
      if (!name) throw new Error("Name the item.");
    };
    try {
      if (action === "list") {
        const items = [];
        for (let index = 0; index < store.length && items.length < 200; index++) {
          const key = store.key(index);
          if (key === null) continue;
          items.push({ name: P.clip(key, 200), value: P.clip(store.getItem(key) ?? "", 2000) });
        }
        return { ok: true, items, ...(store.length > items.length ? { omitted: store.length - items.length } : {}) };
      }
      if (action === "get") {
        named();
        const value = store.getItem(name);
        return { ok: true, found: value !== null, ...(value !== null ? { value: P.clip(value, 20000) } : {}) };
      }
      if (action === "set") {
        named();
        store.setItem(name, String(args.value ?? ""));
        return { ok: true };
      }
      if (action === "delete") {
        named();
        const found = store.getItem(name) !== null;
        store.removeItem(name);
        return { ok: true, removed: found ? 1 : 0 };
      }
      if (action === "clear") {
        const removed = store.length;
        store.clear();
        return { ok: true, removed };
      }
      return { ok: false, code: "storage_invalid", message: "action is list, get, set, delete or clear." };
    } catch (error) {
      return { ok: false, code: "storage_invalid", message: String(error?.message || error) };
    }
  };

  P.networkRequest = (args) => {
    const listed = P.networkLog();
    if (!listed) return { ok: true, watched: false };
    const found = listed.find((entry) => entry.id === Number(args.id));
    if (!found) return { ok: false, attempted: false, errorCode: "browser_network_missing", error: `There is no request ${args.id} in the page's log. List the requests again.` };
    const { detail, ...entry } = found;
    return { ok: true, request: { ...entry, ...(detail || {}) }, ...(detail ? {} : { note: "Misty keeps headers and bodies only for the page's own fetch and XMLHttpRequest calls, the last 100 of them." }) };
  };

  P.networkClear = () => {
    document.dispatchEvent(new CustomEvent("misty:network-clear"));
    return { ok: true };
  };

  P.consoleClear = () => {
    document.dispatchEvent(new CustomEvent("misty:console-clear"));
    return { ok: true };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
