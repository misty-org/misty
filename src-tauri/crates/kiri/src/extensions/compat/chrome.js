// SPDX-License-Identifier: MIT
// Chrome-only APIs that extensions from the Chrome Web Store commonly use.
// Like shims.js, it defines only what WebKit lacks: side panels open in a tab,
// offscreen documents run in this extension's hidden host page, page rules
// (declarativeContent) run here against tab addresses, and site, font and power
// settings read as Misty's and are not changed by extensions. Page rules
// (declarativeContent) are in declarative.js.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { api, manifest, event, method, resolved, unsupported, define, namespace } = compat;
  const url = (path) => (path ? api.runtime.getURL(String(path)) : "");

  if (manifest.side_panel || compat.declared("sidePanel")) {
    const options = { enabled: true, path: manifest.side_panel?.default_path };
    const behavior = { openPanelOnActionClick: false };
    const open = () =>
      options.path
        ? api.tabs.create({ url: url(options.path) }).then(() => undefined)
        : Promise.reject(new Error("This extension has no side panel."));
    let listening = false;
    namespace("sidePanel", {
      open: method(open),
      setOptions: method(({ tabId, path, enabled } = {}) => {
        // Panels are not per tab in Misty; tab-specific options are ignored.
        if (tabId !== undefined) return;
        if (path !== undefined) options.path = path;
        if (enabled !== undefined) options.enabled = Boolean(enabled);
      }),
      getOptions: method(() => ({ ...options })),
      // Registered in the context that asks, which is the background in practice,
      // so one click opens one panel.
      setPanelBehavior: method(({ openPanelOnActionClick } = {}) => {
        behavior.openPanelOnActionClick = Boolean(openPanelOnActionClick);
        const action = api.action ?? api.browserAction;
        if (behavior.openPanelOnActionClick && !listening && action?.onClicked) {
          listening = true;
          action.onClicked.addListener(() => {
            if (behavior.openPanelOnActionClick && options.enabled) void open();
          });
        }
      }),
      getPanelBehavior: method(() => ({ ...behavior })),
      onOpened: event("sidePanel.onOpened"),
    });
  }

  if (compat.declared("offscreen")) {
    const Reason = Object.fromEntries(
      [
        "TESTING", "AUDIO_PLAYBACK", "IFRAME_SCRIPTING", "DOM_SCRAPING", "BLOBS", "DOM_PARSER",
        "USER_MEDIA", "DISPLAY_MEDIA", "WEB_RTC", "CLIPBOARD", "LOCAL_STORAGE", "WORKERS",
        "BATTERY_STATUS", "MATCH_MEDIA", "GEOLOCATION",
      ].map((reason) => [reason, reason]),
    );
    namespace("offscreen", {
      Reason,
      createDocument: method(({ url: path } = {}) => compat.call("offscreen.create", url(path))),
      closeDocument: method(() => compat.call("offscreen.close")),
      hasDocument: method(() => compat.call("offscreen.has")),
    });
    const ContextType = {
      BACKGROUND: "BACKGROUND",
      OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT",
      POPUP: "POPUP",
      SIDE_PANEL: "SIDE_PANEL",
      TAB: "TAB",
    };
    define(api.runtime, "ContextType", ContextType);
    // Extensions check for an existing offscreen document before creating one.
    define(
      api.runtime,
      "getContexts",
      method(async (filter = {}) => {
        const types = filter.contextTypes;
        if (Array.isArray(types) && !types.includes(ContextType.OFFSCREEN_DOCUMENT)) return [];
        const documentUrl = await compat.call("offscreen.get");
        if (!documentUrl) return [];
        if (Array.isArray(filter.documentUrls) && !filter.documentUrls.includes(documentUrl)) return [];
        return [
          {
            contextType: ContextType.OFFSCREEN_DOCUMENT,
            contextId: "offscreen",
            documentUrl,
            documentOrigin: new URL(documentUrl).origin,
            frameId: -1,
            incognito: false,
            tabId: -1,
            windowId: -1,
          },
        ];
      }),
    );
  }
  if (compat.declared("contentSettings")) {
    const managed = "Misty keeps site permissions in its own Settings.";
    const defaults = {
      cookies: "allow",
      images: "allow",
      javascript: "allow",
      popups: "block",
      location: "ask",
      notifications: "ask",
      microphone: "ask",
      camera: "ask",
      automaticDownloads: "ask",
      clipboard: "ask",
      autoVerify: "allow",
      plugins: "block",
    };
    namespace(
      "contentSettings",
      Object.fromEntries(
        Object.entries(defaults).map(([name, setting]) => [
          name,
          {
            get: resolved({ setting }),
            set: unsupported(managed),
            clear: resolved(undefined),
            getResourceIdentifiers: resolved([]),
          },
        ]),
      ),
    );
  }

  if (compat.declared("fontSettings")) {
    const fixed = { levelOfControl: "not_controllable" };
    const managed = "Misty's fonts are not changed by extensions.";
    namespace("fontSettings", {
      getFont: resolved({ fontId: "", ...fixed }),
      setFont: unsupported(managed),
      clearFont: resolved(undefined),
      getFontList: resolved([]),
      getDefaultFontSize: resolved({ pixelSize: 16, ...fixed }),
      setDefaultFontSize: unsupported(managed),
      clearDefaultFontSize: resolved(undefined),
      getDefaultFixedFontSize: resolved({ pixelSize: 13, ...fixed }),
      setDefaultFixedFontSize: unsupported(managed),
      clearDefaultFixedFontSize: resolved(undefined),
      getMinimumFontSize: resolved({ pixelSize: 0, ...fixed }),
      setMinimumFontSize: unsupported(managed),
      clearMinimumFontSize: resolved(undefined),
      onFontChanged: event("fontSettings.onFontChanged"),
      onDefaultFontSizeChanged: event("fontSettings.onDefaultFontSizeChanged"),
      onDefaultFixedFontSizeChanged: event("fontSettings.onDefaultFixedFontSizeChanged"),
      onMinimumFontSizeChanged: event("fontSettings.onMinimumFontSizeChanged"),
    });
  }

  // Keeping the computer awake is not offered to extensions; requests are accepted
  // so startup code keeps running, and the install review says so.
  if (compat.declared("power")) {
    namespace("power", {
      Level: { SYSTEM: "system", DISPLAY: "display" },
      requestKeepAwake: () => {},
      releaseKeepAwake: () => {},
      reportActivity: resolved(undefined),
    });
  }
})();
