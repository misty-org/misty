// SPDX-License-Identifier: MIT
// Namespaces backed by Misty itself. Each call goes through this extension's
// private host page; Misty checks the extension's granted permissions before
// it reads or changes anything.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { api, call, event, method, unsupported, resolved, namespace, declared } = compat;
  const remote = (name) => method((...args) => call(name, ...args));

  if (declared("notifications")) {
    const random = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    namespace("notifications", {
      create: method(async (id, options) => {
        if (typeof id === "object" && id) [id, options] = ["", id];
        const name = id || random();
        await call("notifications.create", name, options ?? {});
        return name;
      }),
      update: remote("notifications.update"),
      clear: remote("notifications.clear"),
      getAll: remote("notifications.getAll"),
      getPermissionLevel: resolved("granted"),
      onClicked: event("notifications.onClicked"),
      onButtonClicked: event("notifications.onButtonClicked"),
      onClosed: event("notifications.onClosed"),
      onShown: event("notifications.onShown"),
    });
  }

  if (declared("downloads")) {
    const unavailable = "This download control is not available in Misty.";
    namespace("downloads", {
      download: remote("downloads.download"),
      search: remote("downloads.search"),
      cancel: remote("downloads.cancel"),
      open: remote("downloads.open"),
      show: remote("downloads.show"),
      showDefaultFolder: remote("downloads.showDefaultFolder"),
      erase: remote("downloads.erase"),
      pause: unsupported(unavailable),
      resume: unsupported(unavailable),
      removeFile: unsupported(unavailable),
      getFileIcon: unsupported(unavailable),
      setShelfEnabled: resolved(undefined),
      setUiOptions: resolved(undefined),
      onCreated: event("downloads.onCreated"),
      onChanged: event("downloads.onChanged"),
      onErased: event("downloads.onErased"),
      onDeterminingFilename: event("downloads.onDeterminingFilename"),
    });
  }

  if (declared("history")) {
    namespace("history", {
      search: remote("history.search"),
      getVisits: remote("history.getVisits"),
      addUrl: remote("history.addUrl"),
      deleteUrl: remote("history.deleteUrl"),
      deleteRange: remote("history.deleteRange"),
      deleteAll: remote("history.deleteAll"),
      onVisited: event("history.onVisited"),
      onVisitRemoved: event("history.onVisitRemoved"),
      onTitleChanged: event("history.onTitleChanged"),
    });
  }

  if (declared("topSites")) namespace("topSites", { get: remote("topSites.get") });

  if (declared("search")) {
    namespace("search", {
      get: remote("search.get"),
      search: remote("search.search"),
      query: remote("search.search"),
    });
  }

  if (declared("sessions")) {
    // Per-tab values live for the browser session, like Firefox's.
    const values = new Map();
    const key = (kind, id, name) => `${kind}:${id}:${name}`;
    const store = (kind) => ({
      set: method((id, name, value) => void values.set(key(kind, id, name), value)),
      get: method((id, name) => values.get(key(kind, id, name))),
      remove: method((id, name) => void values.delete(key(kind, id, name))),
    });
    const tabs = store("tab");
    const windows = store("window");
    namespace("sessions", {
      MAX_SESSION_RESULTS: 25,
      getRecentlyClosed: remote("sessions.getRecentlyClosed"),
      restore: remote("sessions.restore"),
      forgetClosedTab: remote("sessions.forgetClosedTab"),
      forgetClosedWindow: resolved(undefined),
      getDevices: resolved([]),
      setTabValue: tabs.set,
      getTabValue: tabs.get,
      removeTabValue: tabs.remove,
      setWindowValue: windows.set,
      getWindowValue: windows.get,
      removeWindowValue: windows.remove,
      onChanged: event("sessions.onChanged"),
    });
  }

  if (declared("browsingData")) {
    const remove = (types) => method((options) => call("browsingData.remove", options ?? {}, types));
    namespace("browsingData", {
      remove: method((options, types) => call("browsingData.remove", options ?? {}, types ?? {})),
      removeCache: remove({ cache: true }),
      removeCookies: remove({ cookies: true }),
      removeDownloads: remove({ downloads: true }),
      removeHistory: remove({ history: true }),
      removeLocalStorage: remove({ localStorage: true }),
      removeIndexedDB: remove({ indexedDB: true }),
      removeServiceWorkers: remove({ serviceWorkers: true }),
      removeFormData: resolved(undefined),
      removePasswords: resolved(undefined),
      removePluginData: resolved(undefined),
      settings: resolved({
        options: { since: 0 },
        dataToRemove: { cache: false, cookies: false, downloads: false, history: false, localStorage: false },
        dataRemovalPermitted: { cache: true, cookies: true, downloads: true, history: true, localStorage: true },
      }),
    });
  }

  if (declared("find")) {
    namespace("find", {
      find: method(async (query, options = {}) => {
        if (options.tabId !== undefined) {
          const tab = await api.tabs.get(options.tabId);
          if (!tab.active) throw new Error("Misty can only search the active tab.");
        }
        return call("find.find", String(query));
      }),
      highlightResults: resolved(undefined),
      removeHighlighting: remote("find.clear"),
    });
  }

  if (declared("idle")) {
    let interval = 60;
    let last = "active";
    let timer = null;
    const poll = async () => {
      try {
        const state = await call("idle.queryState", interval);
        if (state !== last) compat.emit("idle.onStateChanged", [(last = state)]);
      } catch {
        // The host restarts with the extension; the next poll retries.
      }
    };
    namespace("idle", {
      queryState: remote("idle.queryState"),
      setDetectionInterval: method((seconds) => void (interval = Math.max(15, Number(seconds) || 60))),
      getAutoLockDelay: resolved(0),
      onStateChanged: event("idle.onStateChanged", () => {
        timer ??= setInterval(poll, 15000);
      }),
    });
  }

  if (declared("bookmarks")) {
    namespace("bookmarks", {
      getTree: remote("bookmarks.getTree"),
      getSubTree: remote("bookmarks.getSubTree"),
      getChildren: remote("bookmarks.getChildren"),
      get: remote("bookmarks.get"),
      getRecent: remote("bookmarks.getRecent"),
      search: remote("bookmarks.search"),
      create: remote("bookmarks.create"),
      update: remote("bookmarks.update"),
      move: remote("bookmarks.move"),
      remove: remote("bookmarks.remove"),
      removeTree: remote("bookmarks.removeTree"),
      onCreated: event("bookmarks.onCreated"),
      onChanged: event("bookmarks.onChanged"),
      onMoved: event("bookmarks.onMoved"),
      onRemoved: event("bookmarks.onRemoved"),
      onChildrenReordered: event("bookmarks.onChildrenReordered"),
      onImportBegan: event("bookmarks.onImportBegan"),
      onImportEnded: event("bookmarks.onImportEnded"),
    });
  }

  // Tab groups. WebKit keeps tab ids private, so each tab travels as its index
  // and its window's addresses, the way tabs.move finds it.
  if (api.tabs) {
    const located = (ids) =>
      Promise.all(
        (Array.isArray(ids) ? ids : [ids]).map(async (id) => {
          const tab = await api.tabs.get(id);
          const peers = await api.tabs.query({ windowId: tab.windowId });
          return { from: tab.index, urls: peers.map((peer) => peer.url ?? "") };
        }),
      );
    compat.define(api.tabs, "group", method(async ({ tabIds, groupId } = {}) =>
      call("tabs.group", await located(tabIds), groupId ?? null),
    ));
    compat.define(api.tabs, "ungroup", method(async (ids) => {
      await call("tabs.ungroup", await located(ids));
    }));
  }
  if (declared("tabGroups")) {
    // Group windows are reported as the current window: groups live in one window.
    const windowed = async (value) => {
      const current = await api.windows.getLastFocused().catch(() => null);
      const withWindow = (group) => ({ ...group, windowId: current?.id ?? -1 });
      return Array.isArray(value) ? value.map(withWindow) : withWindow(value);
    };
    namespace("tabGroups", {
      TAB_GROUP_ID_NONE: -1,
      Color: Object.fromEntries(
        ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"].map((c) => [c.toUpperCase(), c]),
      ),
      get: method(async (id) => windowed(await call("tabGroups.get", id))),
      query: method(async (info) => windowed(await call("tabGroups.query", info ?? {}))),
      update: method(async (id, properties) =>
        windowed(await call("tabGroups.update", id, properties ?? {})),
      ),
      move: unsupported("Misty cannot move tab groups from extensions yet."),
      onCreated: event("tabGroups.onCreated"),
      onUpdated: event("tabGroups.onUpdated"),
      onRemoved: event("tabGroups.onRemoved"),
      onMoved: event("tabGroups.onMoved"),
    });
  }

  if (declared("tts")) {
    namespace("tts", {
      speak: remote("tts.speak"),
      stop: remote("tts.stop"),
      pause: remote("tts.pause"),
      resume: remote("tts.resume"),
      isSpeaking: remote("tts.isSpeaking"),
      getVoices: remote("tts.getVoices"),
      onVoicesChanged: event("tts.onVoicesChanged"),
    });
  }
})();
