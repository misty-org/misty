// SPDX-License-Identifier: MIT
// Learned blocking for webRequestBlocking extensions.
//
// WebKit runs blocking webRequest listeners but ignores their answers. Each
// answer that would cancel, redirect or rewrite headers becomes a
// declarativeNetRequest rule, which WebKit enforces natively. The first request
// to a new address can get through; later ones are handled. Rules are checked
// again whenever the extension's settings change, by replaying the request
// that taught them through the extension's current listeners.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  const api = compat?.api;
  const dnr = api?.declarativeNetRequest;
  if (!compat || !api.webRequest || !dnr?.updateDynamicRules || !compat.declared("webRequestBlocking")) return;
  // Only the background owns the rules; a popup has no listeners to replay.
  const background =
    typeof window === "undefined" ||
    (() => {
      try {
        return api.extension.getBackgroundPage?.() === window;
      } catch {
        return false;
      }
    })();
  if (!background) return;

  const BASE = 1_000_000_000;
  const MAX_RULES = Math.min(3000, (dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES ?? 5000) - 1000);
  const PROMOTE_AFTER = 3;
  const EVENTS = ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"];
  const TYPES = new Set(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]);
  const TYPE_ALIASES = { beacon: "ping", imageset: "image", object_subrequest: "object" };
  /** key -> { id, rule, event, sample, listener } */
  const learned = new Map();
  /** event -> Set of the extension's blocking listeners */
  const listeners = new Map(EVENTS.map((name) => [name, new Set()]));
  const wrappers = new WeakMap();
  let enabled = true;

  const hashId = (key) => {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    return BASE + ((hash >>> 0) % 0x10000000);
  };
  const plainFilter = (text) => !/[*^|]/.test(text);
  const resourceType = (type) => {
    const value = TYPE_ALIASES[type] ?? type;
    return TYPES.has(value) ? value : "other";
  };
  const initiatorOf = (details) => {
    if (details.type === "main_frame") return null;
    const source = details.documentUrl ?? details.originUrl ?? details.initiator;
    try {
      return source ? new URL(source).hostname || null : null;
    } catch {
      return null;
    }
  };
  const sampleOf = (details) => ({
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId ?? -1,
    frameId: details.frameId ?? 0,
    parentFrameId: details.parentFrameId ?? -1,
    documentUrl: details.documentUrl,
    originUrl: details.originUrl,
    initiator: details.initiator,
    requestHeaders: details.requestHeaders,
    responseHeaders: details.responseHeaders,
    statusCode: details.statusCode,
    timeStamp: Date.now(),
    requestId: "misty-replay",
  });

  // ---- Persistence, in the extension's own IndexedDB (not its storage API).
  const database = new Promise((resolve) => {
    try {
      const open = indexedDB.open("misty-learned-rules", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("rules");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  async function persist() {
    const db = await database;
    if (!db) return;
    const entries = [...learned].map(([key, entry]) => [key, { id: entry.id, rule: entry.rule, event: entry.event, sample: entry.sample }]);
    const store = db.transaction("rules", "readwrite").objectStore("rules");
    store.put(entries, "entries");
  }
  let persistTimer = null;
  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void persist(), 1000);
  };

  // ---- Rule changes are serialized so concurrent learning cannot race.
  let queue = Promise.resolve();
  function apply(add, remove) {
    queue = queue
      .then(() => dnr.updateDynamicRules({ removeRuleIds: [...remove, ...add.map((rule) => rule.id)], addRules: add }))
      .catch((error) => {
        // A grant can be missing on packages installed before learning existed.
        if (/permission|not allowed|unsupported/i.test(String(error?.message))) enabled = false;
      });
    return queue;
  }
  function remember(key, entry) {
    if (!enabled || learned.has(key)) return;
    const evicted = [];
    while (learned.size >= MAX_RULES) {
      const [oldest, value] = learned.entries().next().value;
      learned.delete(oldest);
      evicted.push(value.id);
    }
    learned.set(key, entry);
    void apply([entry.rule], evicted);
    schedulePersist();
  }
  function forget(keys) {
    const ids = [];
    for (const key of keys) {
      const entry = learned.get(key);
      if (!entry) continue;
      learned.delete(key);
      ids.push(entry.id);
    }
    if (ids.length) {
      void apply([], ids);
      schedulePersist();
    }
  }

  // ---- Learning from one listener answer.
  function learnBlock(event, details, listener) {
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return;
    }
    if (!/^(https?|wss?):$/.test(url.protocol)) return;
    const initiator = initiatorOf(details);
    const type = resourceType(details.type);
    const scope = initiator ? { initiatorDomains: [initiator] } : {};
    const hostKey = `h|${initiator ?? ""}|${url.hostname}`;
    if (learned.has(hostKey)) return;
    const pathKeys = [...learned.keys()].filter((key) => key.startsWith(`b|${initiator ?? ""}|${url.hostname}|`));
    if (pathKeys.length + 1 >= PROMOTE_AFTER && type !== "main_frame") {
      const id = hashId(hostKey);
      forget(pathKeys);
      remember(hostKey, {
        id, event, listener, sample: sampleOf(details),
        rule: { id, priority: 1, action: { type: "block" }, condition: { requestDomains: [url.hostname], excludedResourceTypes: ["main_frame"], ...scope } },
      });
      return;
    }
    const filter = `||${url.host}${url.pathname}^`;
    if (!plainFilter(url.pathname) || filter.length > 1024) return;
    const key = `b|${initiator ?? ""}|${url.hostname}|${url.pathname}|${type}`;
    const id = hashId(key);
    remember(key, {
      id, event, listener, sample: sampleOf(details),
      rule: { id, priority: 1, action: { type: "block" }, condition: { urlFilter: filter, resourceTypes: [type], ...scope } },
    });
  }
  function learnRedirect(event, details, target, listener) {
    if (!plainFilter(details.url) || details.url.length > 1024 || typeof target !== "string") return;
    if (!/^(https?:|data:|webkit-extension:)/i.test(target)) return;
    const key = `r|${details.url}`;
    const id = hashId(key);
    remember(key, {
      id, event, listener, sample: sampleOf(details),
      rule: { id, priority: 2, action: { type: "redirect", redirect: { url: target } }, condition: { urlFilter: `|${details.url}|`, resourceTypes: [resourceType(details.type)] } },
    });
  }
  function headerChanges(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) return [];
    const lower = (headers) => new Map(headers.map((h) => [String(h.name).toLowerCase(), h.value ?? ""]));
    const old = lower(before);
    const next = lower(after);
    const changes = [];
    for (const name of old.keys()) if (!next.has(name)) changes.push({ header: name, operation: "remove" });
    for (const [name, value] of next) if (old.get(name) !== value) changes.push({ header: name, operation: "set", value });
    return changes;
  }
  function learnHeaders(event, details, before, after, listener) {
    const kind = event === "onBeforeSendHeaders" ? "requestHeaders" : "responseHeaders";
    const changes = headerChanges(before, after);
    if (!changes.length) return;
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return;
    }
    const initiator = initiatorOf(details);
    const key = `${kind === "requestHeaders" ? "q" : "s"}|${initiator ?? ""}|${host}|${JSON.stringify(changes)}`;
    const id = hashId(key);
    remember(key, {
      id, event, listener, sample: { ...sampleOf(details), [kind]: before },
      rule: { id, priority: 1, action: { type: "modifyHeaders", [kind]: changes }, condition: { requestDomains: [host], ...(initiator ? { initiatorDomains: [initiator] } : {}) } },
    });
  }
  function learn(event, details, before, answer, listener) {
    if (!answer || typeof answer !== "object") return;
    if (answer.cancel === true) learnBlock(event, details, listener);
    else if (answer.redirectUrl) learnRedirect(event, details, answer.redirectUrl, listener);
    else if (event === "onBeforeSendHeaders" && answer.requestHeaders) learnHeaders(event, details, before, answer.requestHeaders, listener);
    else if (event === "onHeadersReceived" && answer.responseHeaders) learnHeaders(event, details, before, answer.responseHeaders, listener);
  }

  // ---- Wrapping the extension's blocking listeners.
  for (const name of EVENTS) {
    const target = api.webRequest[name];
    if (!target?.addListener) continue;
    compat.retain(target);
    const add = target.addListener.bind(target);
    const remove = target.removeListener.bind(target);
    const has = target.hasListener.bind(target);
    const original = (details) => (name === "onHeadersReceived" ? details.responseHeaders : details.requestHeaders);
    target.addListener = (listener, filter, spec) => {
      const blocking = Array.isArray(spec) && (spec.includes("blocking") || spec.includes("asyncBlocking"));
      if (!blocking || typeof listener !== "function") return add(listener, filter, spec);
      const wrapped = (details) => {
        const before = original(details)?.map((header) => ({ ...header }));
        const answer = listener(details);
        Promise.resolve(answer)
          .then((value) => learn(name, details, before, value, listener))
          .catch(() => {});
        return answer;
      };
      wrappers.set(listener, wrapped);
      listeners.get(name).add(listener);
      return add(wrapped, filter, spec);
    };
    target.removeListener = (listener) => {
      const wrapped = wrappers.get(listener);
      if (!wrapped) return remove(listener);
      listeners.get(name).delete(listener);
      forget([...learned].filter(([, entry]) => entry.listener === listener).map(([key]) => key));
      return remove(wrapped);
    };
    target.hasListener = (listener) => has(wrappers.get(listener) ?? listener);
  }

  // ---- Keep the extension's own view of its dynamic rules unchanged.
  compat.retain(dnr);
  const getDynamicRules = dnr.getDynamicRules.bind(dnr);
  dnr.getDynamicRules = compat.method(async (filter) =>
    (await getDynamicRules(filter)).filter((rule) => rule.id < BASE),
  );

  // ---- Re-checking learned rules when the extension's settings change.
  async function decisionHolds(entry) {
    const candidates = entry.listener ? [entry.listener] : [...listeners.get(entry.event)];
    for (const listener of candidates) {
      try {
        const answer = await listener(structuredClone(entry.sample));
        const action = entry.rule.action.type;
        if (action === "block" && answer?.cancel === true) return true;
        if (action === "redirect" && answer?.redirectUrl === entry.rule.action.redirect.url) return true;
        if (action === "modifyHeaders" && (answer?.requestHeaders || answer?.responseHeaders)) return true;
      } catch {
        // A listener that fails on replay keeps nothing it taught.
      }
    }
    return false;
  }
  let lastCheck = 0;
  let checkTimer = null;
  async function recheck() {
    lastCheck = Date.now();
    const stale = [];
    for (const [key, entry] of learned) if (!(await decisionHolds(entry))) stale.push(key);
    forget(stale);
  }
  const scheduleRecheck = () => {
    clearTimeout(checkTimer);
    const wait = Math.max(3000, 30000 - (Date.now() - lastCheck));
    checkTimer = setTimeout(() => void recheck(), wait);
  };
  api.storage?.onChanged?.addListener(scheduleRecheck);

  // ---- Restore persisted rules, drop orphans, and validate after startup.
  void (async () => {
    const db = await database;
    const saved = db
      ? await new Promise((resolve) => {
          const request = db.transaction("rules").objectStore("rules").get("entries");
          request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
          request.onerror = () => resolve([]);
        })
      : [];
    for (const [key, entry] of saved) if (!learned.has(key)) learned.set(key, { ...entry, listener: null });
    const known = new Set([...learned.values()].map((entry) => entry.id));
    const existing = await getDynamicRules().catch(() => []);
    const orphans = existing.filter((rule) => rule.id >= BASE && !known.has(rule.id)).map((rule) => rule.id);
    const missing = [...learned.values()].filter((entry) => !existing.some((rule) => rule.id === entry.id));
    if (orphans.length || missing.length) await apply(missing.map((entry) => entry.rule), orphans);
    // Listeners register during startup; give them time before replaying.
    setTimeout(() => void recheck(), 10000);
  })();
})();
