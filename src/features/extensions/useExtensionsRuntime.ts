import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "@/features/auth";
import { useDevicePreferences } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  activeLayoutView,
  allLayoutPanes,
  allLayoutViews,
  parseBrowserViewState,
  useWorkspaceStore,
} from "@/features/workspace";
import { requestBrowserWebviewLayout } from "@/features/browser";
import { browserRuntimeId } from "@/features/browser";
import { useBrowserMediaStore } from "@/features/browser";
import { answerCompatRequest, startCompatEvents } from "./compat/requests";
import { startNewTabOverride } from "./newTabOverride";
import type { ExtensionEvent } from "./types";
import { extensionsNative } from "./native";
import {
  closeExtensionPopup,
  extensionWindowIdFor,
  floatExtensionPopup,
  watchExtensionPopups,
} from "./extensionPopups";
import { isIncognitoWindow, isLinkTargetWindow } from "@/features/workspace/spaceWindow";
import {
  enqueuePermission,
  finishPermission,
  revokePermissions,
  installations,
  updateInstallation,
  parseInstallations,
  spaceInstallationsRaw,
  useExtensionsStore,
} from "./store";

let reconcileQueue: Promise<unknown> = Promise.resolve();
function publishLayout() {
  const workspace = useWorkspaceStore.getState();
  const layout = workspace.layout;
  const media = useBrowserMediaStore.getState();
  // This window is one extension window; a floating popup counts as a window of its own.
  return extensionsNative.layout(
    allLayoutPanes(layout)
      .flatMap((pane) =>
        pane.views
          .filter((v) => v.surfaceId === "browser")
          .map((tab) => ({
            id: browserRuntimeId(tab),
            windowId: extensionWindowIdFor(tab.id) ?? workspace.activeWindowId,
            url: parseBrowserViewState(tab.state).url ?? "about:blank",
            title: tab.title ?? "Browser",
            private: isIncognitoWindow(),
            active: pane.activeViewId === tab.id && layout.focusedPaneId === pane.id,
            focused: layout.focusedPaneId === pane.id,
            muted: Boolean(media.muted[tab.id]),
            audible: Boolean(media.audible[tab.id]),
          })),
      )
      .map((tab, index) => ({ ...tab, index })),
  );
}
/** Opens the window or tab an extension asked for, in this Space window. */
function openFromExtension(event: ExtensionEvent) {
  const previousView = activeLayoutView(useWorkspaceStore.getState().layout);
  if (event.kind === "open-window") {
    const urls = event.urls?.length ? event.urls : ["about:blank"];
    const created = urls.map((url) => useWorkspaceStore.getState().openBrowserView({ url }));
    const floating = event.popup && created[0];
    if (event.focused === false && previousView && !floating)
      useWorkspaceStore.getState().focusView(previousView.id);
    if (event.requestId && created[0])
      void publishLayout()
        .then(() => extensionsNative.tabCreated(event.requestId!, browserRuntimeId(created[0]!)))
        .catch(() => {});
    if (floating) void floatExtensionPopup(created[0]!, event, previousView?.id);
    return;
  }
  if (!event.url) return;
  const created = useWorkspaceStore.getState().openBrowserView({ url: event.url });
  if (event.index !== undefined && Number.isSafeInteger(event.index))
    useWorkspaceStore.getState().reorderView("", created.id, event.index);
  if (event.focused === false && previousView)
    useWorkspaceStore.getState().focusView(previousView.id);
  if (event.requestId)
    void publishLayout()
      .then(() => extensionsNative.tabCreated(event.requestId!, browserRuntimeId(created)))
      .catch(() => {});
}

export function useExtensionsRuntime() {
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const { user } = useAuth();
  const account = user?.id ?? "";
  const profile = useDevicePreferences((s) => s.state);
  const profilesReady = useDevicePreferences((s) => s.ready);
  const profilesError = useDevicePreferences((s) => s.error);
  const raw = spaceInstallationsRaw(profile);
  const agentAccess = profile
    ? Boolean(resolveSetting(profile, "extensions.agent_access").value)
    : true;
  useEffect(() => {
    if (!hasTauriInternals()) {
      useExtensionsStore.setState({ account, ready: true, supported: false });
      return;
    }
    let current = true;
    useExtensionsStore.setState((s) => ({
      account,
      ready: s.account === account && s.ready,
      states: s.account === account ? s.states : [],
      permissionRequests: s.account === account ? s.permissionRequests : [],
      error: "",
    }));
    if (account && !profilesReady) {
      if (profilesError)
        useExtensionsStore.setState({
          ready: true,
          supported: false,
          error: `Extensions could not load settings: ${profilesError}`,
        });
      return;
    }
    reconcileQueue = reconcileQueue
      .catch(() => {})
      .then(async () => {
        if (!current) return;
        try {
          const states = await extensionsNative.reconcile(
            account,
            parseInstallations(raw),
            agentAccess,
          );
          if (current) {
            useExtensionsStore.setState({ states, ready: true, supported: true });
            void publishLayout().catch(() => {});
          }
        } catch (error) {
          if (current)
            useExtensionsStore.setState({ ready: true, supported: false, error: String(error) });
        }
      });
    return () => {
      current = false;
    };
  }, [account, profilesReady, profilesError, raw, agentAccess, runtimeGeneration]);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let cancelled = false;
    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (state.layout !== previous.layout || state.activeWindowId !== previous.activeWindowId)
        void publishLayout().catch(() => {});
    });
    const unsubscribeMedia = useBrowserMediaStore.subscribe((state, previous) => {
      if (state.muted !== previous.muted || state.audible !== previous.audible)
        void publishLayout().catch(() => {});
    });
    const stopCompatEvents = startCompatEvents();
    const stopNewTabOverride = startNewTabOverride();
    const stopPopups = watchExtensionPopups();
    const listener = listen<ExtensionEvent>("misty://extensions", ({ payload: event }) => {
      // Events come from this window's Space; its incognito windows run no extensions.
      if (cancelled || event.account !== account || isIncognitoWindow()) return;
      // Extension API calls are frequent and change no extension UI state.
      if (event.kind === "compat-request") {
        void answerCompatRequest(event);
        return;
      }
      useExtensionsStore.setState((s) => ({ revision: s.revision + 1 }));
      if (event.kind === "runtime-reset") {
        useExtensionsStore.setState({ ready: false, states: [], permissionRequests: [] });
        setRuntimeGeneration((v) => v + 1);
      }
      if (event.kind === "runtime-error")
        useExtensionsStore.setState((state) => ({
          states: state.states.map((item) =>
            item.id === String(event.id)
              ? {
                  ...item,
                  status: event.detail ? "needs-attention" : "enabled",
                  detail: event.detail || null,
                }
              : item,
          ),
        }));
      if (event.kind === "permissions-removed" && event.id)
        void revokePermissions(String(event.id), event.permissions ?? [], event.hosts ?? []).catch(
          () => {},
        );
      if (event.kind === "permission-expired" && event.requestId) finishPermission(event.requestId);
      if (event.kind === "permission-request") enqueuePermission(event);
      if (event.kind === "store-install" && typeof event.id === "string")
        useExtensionsStore.setState({ installRequest: event.id });
      if (event.kind === "store-remove" && typeof event.id === "string")
        useExtensionsStore.setState({ removeRequest: event.id });
      if (
        event.kind === "uninstalled" &&
        installations().some((i) => i.id === String(event.id) && i.generation === event.generation)
      )
        void updateInstallation(String(event.id), {
          installed: false,
          enabled: false,
          permissions: [],
          hosts: [],
        }).catch(() => {});
      if (event.kind === "sync-status")
        useExtensionsStore.setState({ error: event.detail ?? "Extension sync needs attention." });
      const workspace = useWorkspaceStore.getState();
      const tab = allLayoutViews(workspace.layout).find((t) => browserRuntimeId(t) === event.tabId);
      // Closing an extension's window closes only its floating popup, never a Space window.
      if (event.kind === "close-window" || event.kind === "close-tab")
        closeExtensionPopup({ tabId: event.tabId, windowId: event.windowId });
      // A new window or tab the extension asks for opens once, in the window used last.
      const opening = event.kind === "open-window" || (event.kind === "open-tab" && event.url);
      if (opening)
        void isLinkTargetWindow().then((target) => {
          if (target && !cancelled) openFromExtension(event);
        });
      if (event.kind === "activate-tab" && tab) workspace.focusView(tab.id);
      if (event.kind === "move-tab" && tab && event.index !== undefined)
        workspace.reorderView("", tab.id, event.index);
      if (event.kind === "tab-muted" && tab)
        useBrowserMediaStore.getState().setMutedState(tab.id, Boolean(event.muted));
      if (event.kind === "close-tab" && tab) {
        const previous = activeLayoutView(workspace.layout);
        workspace.focusView(tab.id);
        useWorkspaceStore.getState().closeView(tab.id);
        if (previous && previous.id !== tab.id) useWorkspaceStore.getState().focusView(previous.id);
      }
      if ((event.kind === "navigate" || event.kind === "replace-view") && tab && event.url) {
        workspace.updateBrowserView(tab.id, { url: event.url });
        requestBrowserWebviewLayout(tab);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeMedia();
      stopCompatEvents();
      stopNewTabOverride();
      stopPopups();
      void listener.then((off) => off());
    };
  }, [account]);
  useEffect(() => {
    if (!account || !profilesReady || !hasTauriInternals()) return;
    let stopped = false;
    const check = () =>
      void reconcileQueue
        .then(() => extensionsNative.updates())
        .then((states) => {
          if (!stopped) useExtensionsStore.setState({ states });
        })
        .catch(() => {});
    const initial = window.setTimeout(check, 10_000);
    const interval = window.setInterval(check, 24 * 60 * 60 * 1000);
    return () => {
      stopped = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [account, profilesReady]);
}
