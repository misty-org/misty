// SPDX-License-Identifier: MIT
// Shims that need no native support: self-describing APIs, Firefox-only
// additions to existing namespaces, and honest "not available" answers that keep
// startup code from throwing on a missing object.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { api, manifest, event, method, unsupported, resolved, define, namespace } = compat;
  const url = (path) => (path ? api.runtime.getURL(path) : "");
  const message = (value) => {
    const key = /^__MSG_(.+)__$/.exec(value ?? "")?.[1];
    return key ? api.i18n.getMessage(key) || value : (value ?? "");
  };

  // runtime
  define(api.runtime, "getBrowserInfo", resolved({ name: "Misty", vendor: "Misty", version: "1", buildID: "1" }));
  define(api.runtime, "onUpdateAvailable", event("runtime.onUpdateAvailable"));
  define(api.runtime, "onSuspend", event("runtime.onSuspend"));
  define(api.runtime, "onSuspendCanceled", event("runtime.onSuspendCanceled"));
  define(api.runtime, "onRestartRequired", event("runtime.onRestartRequired"));
  define(api.runtime, "requestUpdateCheck", resolved({ status: "no_update" }));

  // storage.managed: Misty has no enterprise policy store.
  if (api.storage) {
    define(api.storage, "managed", {
      get: resolved({}),
      getBytesInUse: resolved(0),
      onChanged: event("storage.managed.onChanged"),
    });
  }

  // Apple's language recognizer answers i18n.detectLanguage.
  define(api.i18n, "detectLanguage", method((text) => compat.call("i18n.detectLanguage", String(text ?? ""))));

  // tabs additions
  if (api.tabs) {
    define(api.tabs, "hide", resolved([]));
    define(api.tabs, "show", resolved(undefined));
    define(api.tabs, "discard", resolved(undefined));
    define(api.tabs, "warmup", resolved(undefined));
    // WebKit keeps tab ids private, so Misty finds a tab by its window's order.
    define(api.tabs, "move", method(async (ids, properties = {}) => {
      const list = Array.isArray(ids) ? ids : [ids];
      let next = Number.isInteger(properties.index) ? properties.index : -1;
      const moved = [];
      for (const id of list) {
        const tab = await api.tabs.get(id);
        if (properties.windowId !== undefined && properties.windowId !== tab.windowId)
          throw new Error("Misty cannot move tabs between windows yet.");
        const peers = await api.tabs.query({ windowId: tab.windowId });
        const to = next < 0 || next >= peers.length ? peers.length - 1 : next;
        await compat.call("tabs.move", { from: tab.index, to, urls: peers.map((peer) => peer.url ?? "") });
        moved.push({ ...tab, index: to });
        if (next >= 0) next++;
      }
      return Array.isArray(ids) ? moved : moved[0];
    }));
    // Misty has no multi-selection; highlighting activates the first index.
    define(api.tabs, "highlight", method(async ({ tabs, windowId } = {}) => {
      const index = Array.isArray(tabs) ? tabs[0] : tabs;
      const [tab] = await api.tabs.query({ windowId: windowId ?? api.windows.WINDOW_ID_CURRENT, index });
      if (tab) await api.tabs.update(tab.id, { active: true });
      return api.windows.get(tab?.windowId ?? api.windows.WINDOW_ID_CURRENT);
    }));
  }

  // Firefox menus additions
  for (const menus of [api.menus, api.contextMenus]) {
    if (!menus) continue;
    define(menus, "refresh", resolved(undefined));
    define(menus, "overrideContext", resolved(undefined));
    define(menus, "onShown", event("menus.onShown"));
    define(menus, "onHidden", event("menus.onHidden"));
  }

  // Toolbar action additions, plus page_action mapped onto the toolbar button.
  const action = api.browserAction ?? api.action;
  if (action) {
    define(action, "setBadgeTextColor", resolved(undefined));
    define(action, "getBadgeTextColor", resolved([0, 0, 0, 255]));
    define(action, "getUserSettings", resolved({ isOnToolbar: true }));
    if (manifest.page_action) {
      namespace("pageAction", {
        show: method((tabId) => action.enable(tabId)),
        hide: method((tabId) => action.disable(tabId)),
        isShown: method(({ tabId }) => action.isEnabled?.({ tabId }) ?? true),
        setTitle: method((details) => action.setTitle(details)),
        getTitle: method((details) => action.getTitle(details)),
        setIcon: method((details) => action.setIcon(details)),
        setPopup: method((details) => action.setPopup(details)),
        getPopup: method((details) => action.getPopup(details)),
        openPopup: method(() => action.openPopup?.()),
        onClicked: action.onClicked,
      });
    }
  }

  // commands without a manifest key
  namespace("commands", {
    getAll: resolved([]),
    update: resolved(undefined),
    reset: resolved(undefined),
    onCommand: event("commands.onCommand"),
    onChanged: event("commands.onChanged"),
  });

  // management: an extension may always describe itself.
  const self = () => ({
    id: api.runtime.id,
    name: message(manifest.name),
    shortName: message(manifest.short_name ?? manifest.name),
    description: message(manifest.description),
    version: manifest.version,
    versionName: manifest.version_name,
    mayDisable: true,
    enabled: true,
    homepageUrl: manifest.homepage_url,
    optionsUrl: url(manifest.options_ui?.page ?? manifest.options_page),
    installType: "normal",
    type: "extension",
    offlineEnabled: false,
    permissions: (manifest.permissions ?? []).filter((p) => !p.includes(":") && p !== "<all_urls>"),
    hostPermissions: [
      ...(manifest.host_permissions ?? []),
      ...(manifest.permissions ?? []).filter((p) => p.includes(":") || p === "<all_urls>"),
    ],
    icons: Object.entries(manifest.icons ?? {}).map(([size, path]) => ({ size: Number(size), url: url(path) })),
  });
  const otherExtensions = "Misty does not share other extensions' details.";
  namespace("management", {
    getSelf: method(self),
    getAll: method(() => [self()]),
    get: method((id) => (id === api.runtime.id ? self() : Promise.reject(new Error(otherExtensions)))),
    getPermissionWarningsById: resolved([]),
    getPermissionWarningsByManifest: resolved([]),
    setEnabled: unsupported(otherExtensions),
    uninstall: unsupported(otherExtensions),
    uninstallSelf: unsupported("Remove extensions from Misty's Extensions page."),
    onInstalled: event("management.onInstalled"),
    onUninstalled: event("management.onUninstalled"),
    onEnabled: event("management.onEnabled"),
    onDisabled: event("management.onDisabled"),
  });

  // identity: OAuth redirects come back through Misty's navigation handler.
  const redirectBase = () => `https://${new URL(api.runtime.getURL("/")).host.toLowerCase()}.extensions.misty.invalid/`;
  namespace("identity", {
    getRedirectURL: (path = "") => redirectBase() + String(path).replace(/^\//, ""),
    getProfileUserInfo: resolved({ email: "", id: "" }),
    getAuthToken: unsupported("Google account tokens are not available in Misty. Use launchWebAuthFlow."),
    removeCachedAuthToken: resolved(undefined),
    clearAllCachedAuthTokens: resolved(undefined),
    onSignInChanged: event("identity.onSignInChanged"),
    launchWebAuthFlow: method(async ({ url: start, interactive } = {}) => {
      if (!interactive) throw new Error("User interaction required.");
      if (!/^https?:/i.test(String(start))) throw new Error("The sign-in address must use http or https.");
      const tab = await api.tabs.create({ url: start, active: true });
      return new Promise((resolve, reject) => {
        const finish = (settle, value) => {
          compat.identityWaiters.delete(onRedirect);
          api.tabs.onRemoved.removeListener(onRemoved);
          settle(value);
        };
        const onRedirect = (target) => {
          if (!target.toLowerCase().startsWith(redirectBase())) return;
          finish(resolve, target);
          api.tabs.remove(tab.id).catch(() => {});
        };
        const onRemoved = (id) => {
          if (id === tab.id) finish(reject, new Error("The user did not approve access."));
        };
        compat.identityWaiters.add(onRedirect);
        api.tabs.onRemoved.addListener(onRemoved);
      });
    }),
  });

  // Firefox sidebar panels open as the toolbar popup or in a tab.
  if (manifest.sidebar_action) {
    let panel = manifest.sidebar_action.default_panel;
    let title = message(manifest.sidebar_action.default_title ?? manifest.name);
    const open = method(() => api.tabs.create({ url: url(panel) }).then(() => undefined));
    namespace("sidebarAction", {
      open,
      toggle: open,
      close: resolved(undefined),
      isOpen: resolved(false),
      setPanel: method(({ panel: next } = {}) => void (panel = next ?? manifest.sidebar_action.default_panel)),
      getPanel: method(() => url(panel)),
      setTitle: method(({ title: next } = {}) => void (title = next ?? title)),
      getTitle: method(() => title),
      setIcon: resolved(undefined),
    });
  }

  if (compat.declared("contextualIdentities")) {
    const containers = "Firefox containers are not available in Misty.";
    namespace("contextualIdentities", {
      query: resolved([]),
      get: unsupported(containers),
      create: unsupported(containers),
      update: unsupported(containers),
      remove: unsupported(containers),
      move: unsupported(containers),
      onCreated: event("contextualIdentities.onCreated"),
      onUpdated: event("contextualIdentities.onUpdated"),
      onRemoved: event("contextualIdentities.onRemoved"),
    });
  }

  if (compat.declared("privacy")) {
    const setting = (name, value) => ({
      get: resolved({ value, levelOfControl: "not_controllable" }),
      set: resolved(false),
      clear: resolved(false),
      onChange: event(`privacy.${name}.onChange`),
    });
    namespace("privacy", {
      network: {
        networkPredictionEnabled: setting("networkPredictionEnabled", true),
        peerConnectionEnabled: setting("peerConnectionEnabled", true),
        webRTCIPHandlingPolicy: setting("webRTCIPHandlingPolicy", "default"),
        httpsOnlyMode: setting("httpsOnlyMode", "never"),
        globalPrivacyControl: setting("globalPrivacyControl", false),
      },
      services: { passwordSavingEnabled: setting("passwordSavingEnabled", false) },
      websites: {
        hyperlinkAuditingEnabled: setting("hyperlinkAuditingEnabled", true),
        referrersEnabled: setting("referrersEnabled", true),
        thirdPartyCookiesAllowed: setting("thirdPartyCookiesAllowed", false),
        trackingProtectionMode: setting("trackingProtectionMode", "always"),
        firstPartyIsolate: setting("firstPartyIsolate", false),
        resistFingerprinting: setting("resistFingerprinting", false),
        cookieConfig: setting("cookieConfig", { behavior: "reject_trackers", nonPersistentCookies: false }),
      },
    });
  }

  if (compat.declared("theme")) {
    namespace("theme", {
      getCurrent: resolved({}),
      update: resolved(undefined),
      reset: resolved(undefined),
      onUpdated: event("theme.onUpdated"),
    });
  }

  if (compat.declared("bookmarks")) {
    const bookmarks = "Bookmarks are not shared with extensions in Misty yet.";
    namespace("bookmarks", {
      getTree: resolved([{ id: "root________", title: "", type: "folder", children: [] }]),
      getSubTree: resolved([]),
      getChildren: resolved([]),
      get: resolved([]),
      getRecent: resolved([]),
      search: resolved([]),
      create: unsupported(bookmarks),
      update: unsupported(bookmarks),
      move: unsupported(bookmarks),
      remove: unsupported(bookmarks),
      removeTree: unsupported(bookmarks),
      onCreated: event("bookmarks.onCreated"),
      onChanged: event("bookmarks.onChanged"),
      onMoved: event("bookmarks.onMoved"),
      onRemoved: event("bookmarks.onRemoved"),
      onChildrenReordered: event("bookmarks.onChildrenReordered"),
    });
  }

})();
