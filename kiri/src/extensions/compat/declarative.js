// SPDX-License-Identifier: MIT
// Chrome's page rules (declarativeContent), which WebKit lacks. Rules are checked
// against tab addresses in the extension's background and kept across restarts
// in its own IndexedDB. Conditions on page contents (CSS, bookmarks) need the
// page itself and count as met.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { api, method, namespace } = compat;

  if (compat.declared("declarativeContent")) {
    class PageStateMatcher {
      constructor(options = {}) {
        Object.assign(this, options);
      }
    }
    class ShowAction {}
    class ShowPageAction {}
    class SetIcon {
      constructor(options = {}) {
        this.options = options;
      }
    }
    class RequestContentScript {
      constructor(options = {}) {
        this.options = options;
      }
    }
    const rules = new Map();
    let sequence = 0;
    // Chrome keeps rules across restarts, and extensions add them once at install,
    // so they are kept in this extension's own IndexedDB, apart from its storage.
    const plain = (rule) => ({
      id: rule.id,
      priority: rule.priority,
      conditions: (rule.conditions ?? []).map(({ pageUrl, css, isBookmarked }) => ({ pageUrl, css, isBookmarked })),
      actions: (rule.actions ?? []).map((a) =>
        a instanceof SetIcon
          ? { type: "icon", options: a.options }
          : a instanceof RequestContentScript
            ? { type: "script", options: a.options }
            : { type: a instanceof ShowAction || a instanceof ShowPageAction ? "show" : "other" },
      ),
    });
    const revived = (rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => new PageStateMatcher(condition)),
      actions: rule.actions.map((a) =>
        a.type === "icon"
          ? new SetIcon(a.options)
          : a.type === "script"
            ? new RequestContentScript(a.options)
            : a.type === "show"
              ? new ShowAction()
              : {},
      ),
    });
    const database = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("__misty_compat__", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("declarativeContent");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const transact = async (mode, work) => {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("declarativeContent", mode);
        const request = work(transaction.objectStore("declarativeContent"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
      });
    };
    const save = () =>
      transact("readwrite", (store) => store.put([...rules.values()].map(plain), "rules")).catch(() => {});
    const loaded = (globalThis.indexedDB
      ? transact("readonly", (store) => store.get("rules"))
      : Promise.resolve([])
    )
      .then((stored) => {
        for (const rule of Array.isArray(stored) ? stored : []) {
          if (rules.has(rule.id)) continue;
          rules.set(rule.id, revived(rule));
          sequence = Math.max(sequence, Number(String(rule.id).replace(/^rule-/, "")) || 0);
        }
      })
      .catch(() => {});
    const text = (value) => String(value ?? "");
    // A UrlFilter, as Chrome reads it; every field given must hold.
    const urlMatches = (filter = {}, address) => {
      let url;
      try {
        url = new URL(address);
      } catch {
        return false;
      }
      const host = url.hostname;
      const path = url.pathname;
      const query = url.search.replace(/^\?/, "");
      const whole = url.href;
      const checks = {
        hostContains: (v) => `.${host}`.includes(text(v)),
        hostEquals: (v) => host === text(v),
        hostPrefix: (v) => host.startsWith(text(v)),
        hostSuffix: (v) => host.endsWith(text(v)),
        pathContains: (v) => path.includes(text(v)),
        pathEquals: (v) => path === text(v),
        pathPrefix: (v) => path.startsWith(text(v)),
        pathSuffix: (v) => path.endsWith(text(v)),
        queryContains: (v) => query.includes(text(v)),
        queryEquals: (v) => query === text(v),
        queryPrefix: (v) => query.startsWith(text(v)),
        querySuffix: (v) => query.endsWith(text(v)),
        urlContains: (v) => whole.includes(text(v)),
        urlEquals: (v) => whole === text(v),
        urlPrefix: (v) => whole.startsWith(text(v)),
        urlSuffix: (v) => whole.endsWith(text(v)),
        urlMatches: (v) => new RegExp(text(v)).test(whole),
        originAndPathMatches: (v) => new RegExp(text(v)).test(`${url.origin}${path}`),
        schemes: (v) => Array.isArray(v) && v.includes(url.protocol.replace(":", "")),
        ports: (v) =>
          Array.isArray(v) &&
          v.some((port) => {
            const actual = Number(url.port || (url.protocol === "https:" ? 443 : 80));
            return Array.isArray(port) ? actual >= port[0] && actual <= port[1] : actual === port;
          }),
      };
      return Object.entries(filter).every(([key, value]) => {
        try {
          return checks[key] ? checks[key](value) : true;
        } catch {
          return false;
        }
      });
    };
    // CSS and bookmark conditions need the page itself; they count as met.
    const conditionMet = (condition, tab) => !condition.pageUrl || urlMatches(condition.pageUrl, tab.url);
    const action = api.action ?? api.pageAction ?? api.browserAction;
    const shown = new Set();
    const injected = new Map();
    const evaluate = async (tab) => {
      if (!tab || tab.id === undefined || !tab.url) return;
      const matched = [...rules.values()].filter((rule) =>
        (rule.conditions ?? []).some((condition) => conditionMet(condition, tab)),
      );
      const actions = matched.flatMap((rule) => rule.actions ?? []);
      const show = actions.some((a) => a instanceof ShowAction || a instanceof ShowPageAction);
      if (show && !shown.has(tab.id)) {
        shown.add(tab.id);
        await action?.enable?.(tab.id);
        await action?.show?.(tab.id);
      } else if (!show && shown.has(tab.id)) {
        // Only tabs a rule turned on go back off; the extension's own state stays.
        shown.delete(tab.id);
        await action?.disable?.(tab.id);
        await action?.hide?.(tab.id);
      }
      for (const icon of actions.filter((a) => a instanceof SetIcon))
        await action?.setIcon?.({ ...icon.options, tabId: tab.id });
      const scripts = actions.filter((a) => a instanceof RequestContentScript);
      if (scripts.length && api.scripting && injected.get(tab.id) !== tab.url) {
        injected.set(tab.id, tab.url);
        for (const { options } of scripts) {
          const target = { tabId: tab.id, allFrames: Boolean(options.allFrames) };
          if (options.css?.length) await api.scripting.insertCSS({ target, files: options.css }).catch(() => {});
          if (options.js?.length) await api.scripting.executeScript({ target, files: options.js }).catch(() => {});
        }
      }
    };
    const evaluateAll = async () => {
      for (const tab of await api.tabs.query({}).catch(() => [])) await evaluate(tab).catch(() => {});
    };
    let watching = false;
    const watch = () => {
      if (watching) return;
      watching = true;
      api.tabs.onUpdated.addListener((_, change, tab) => {
        if (change.url || change.status === "complete") void evaluate(tab).catch(() => {});
      });
      api.tabs.onActivated.addListener(({ tabId }) => {
        void api.tabs.get(tabId).then(evaluate).catch(() => {});
      });
      api.tabs.onRemoved.addListener((tabId) => {
        shown.delete(tabId);
        injected.delete(tabId);
      });
    };
    const pick = (ids) => (Array.isArray(ids) ? ids : [...rules.keys()]);
    // Rules act from the background only, so popups and pages don't repeat them.
    void loaded.then(() => {
      if (!rules.size || !compat.background) return;
      watch();
      void evaluateAll();
    });
    const onPageChanged = {
      addRules: method(async (added = []) => {
        await loaded;
        const result = added.map((rule) => {
          const id = rule.id ?? `rule-${++sequence}`;
          const stored = { priority: 100, ...rule, id };
          rules.set(id, stored);
          return stored;
        });
        void save();
        watch();
        await evaluateAll();
        return result;
      }),
      removeRules: method(async (ids) => {
        await loaded;
        for (const id of pick(ids)) rules.delete(id);
        void save();
        await evaluateAll();
      }),
      getRules: method(async (ids) => {
        await loaded;
        return pick(ids).filter((id) => rules.has(id)).map((id) => rules.get(id));
      }),
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false,
    };
    namespace("declarativeContent", {
      PageStateMatcher,
      ShowAction,
      ShowPageAction,
      SetIcon,
      RequestContentScript,
      onPageChanged,
    });
  }

})();
