import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "@/features/auth";
import { useSettingsProfiles } from "@/features/settings";
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
import type { ExtensionEvent } from "./types";
import { extensionsNative } from "./native";
import {
  enqueuePermission,
  finishPermission,
  revokePermissions,
  installations,
  updateInstallation,
  parseInstallations,
  useExtensionsStore,
} from "./store";

let reconcileQueue: Promise<unknown> = Promise.resolve();
function publishLayout() {
  const workspace = useWorkspaceStore.getState();
  const windows = workspace.windowsByScope[workspace.activeScopeKey] ?? [];
  const media = useBrowserMediaStore.getState();
  return extensionsNative.layout(
    windows.flatMap((window) =>
      allLayoutPanes(window.layout)
        .flatMap((pane) =>
          pane.views
            .filter((v) => v.surfaceId === "browser")
            .map((tab) => ({
              id: browserRuntimeId(tab),
              windowId: window.id,
              url: parseBrowserViewState(tab.state).url ?? "about:blank",
              title: tab.title ?? "Browser",
              private: parseBrowserViewState(tab.state).private ?? false,
              active: pane.activeViewId === tab.id && window.layout.focusedPaneId === pane.id,
              focused:
                workspace.activeWindowId === window.id && window.layout.focusedPaneId === pane.id,
              muted: Boolean(media.muted[tab.id]),
              audible: Boolean(media.audible[tab.id]),
            })),
        )
        .map((tab, index) => ({ ...tab, index })),
    ),
  );
}
export function useExtensionsRuntime() {
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const { user } = useAuth();
  const account = user?.id ?? "";
  const profile = useSettingsProfiles((s) => (account && s.accountId === account ? s.state : null));
  const profilesReady = useSettingsProfiles((s) => s.ready && s.accountId === account);
  const profilesError = useSettingsProfiles((s) => (s.accountId === account ? s.error : null));
  const raw = profile ? String(resolveSetting(profile, "extensions.installations").value) : "[]";
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
          error: `Extensions could not load account settings: ${profilesError}`,
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
      if (
        state.layout !== previous.layout ||
        state.activeWindowId !== previous.activeWindowId ||
        state.windowsByScope !== previous.windowsByScope
      )
        void publishLayout().catch(() => {});
    });
    const unsubscribeMedia = useBrowserMediaStore.subscribe((state, previous) => {
      if (state.muted !== previous.muted || state.audible !== previous.audible)
        void publishLayout().catch(() => {});
    });
    const stopCompatEvents = startCompatEvents();
    const listener = listen<ExtensionEvent>("misty://extensions", ({ payload: event }) => {
      if (cancelled || event.account !== account) return;
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
            item.id === Number(event.id)
              ? {
                  ...item,
                  status: event.detail ? "needs-attention" : "enabled",
                  detail: event.detail || null,
                }
              : item,
          ),
        }));
      if (event.kind === "permissions-removed" && event.id)
        void revokePermissions(Number(event.id), event.permissions ?? [], event.hosts ?? []).catch(
          () => {},
        );
      if (event.kind === "permission-expired" && event.requestId) finishPermission(event.requestId);
      if (event.kind === "permission-request") enqueuePermission(event);
      if (
        event.kind === "uninstalled" &&
        installations().some((i) => i.id === Number(event.id) && i.generation === event.generation)
      )
        void updateInstallation(Number(event.id), {
          installed: false,
          enabled: false,
          permissions: [],
          hosts: [],
        }).catch(() => {});
      if (event.kind === "sync-status")
        useExtensionsStore.setState({ error: event.detail ?? "Extension sync needs attention." });
      const workspace = useWorkspaceStore.getState();
      const tab = (workspace.windowsByScope[workspace.activeScopeKey] ?? [])
        .flatMap((window) => allLayoutViews(window.layout))
        .find((t) => browserRuntimeId(t) === event.tabId);
      if (event.kind === "focus-window" && event.windowId) workspace.switchWindow(event.windowId);
      if (event.kind === "close-window" && event.windowId) workspace.closeWindow(event.windowId);
      if (event.kind === "open-window") {
        const previousWindow = workspace.activeWindowId;
        workspace.createWindow();
        const urls = event.urls?.length ? event.urls : ["about:blank"];
        const created = urls.map((url) =>
          useWorkspaceStore.getState().openBrowserView({ url, private: event.private ?? false }),
        );
        if (event.focused === false && previousWindow)
          useWorkspaceStore.getState().switchWindow(previousWindow);
        if (event.requestId && created[0])
          void publishLayout()
            .then(() =>
              extensionsNative.tabCreated(event.requestId!, browserRuntimeId(created[0]!)),
            )
            .catch(() => {});
      }
      if (event.kind === "open-tab" && event.url) {
        const previousView = activeLayoutView(workspace.layout);
        if (event.windowId) workspace.switchWindow(event.windowId);
        const created = useWorkspaceStore.getState().openBrowserView({
          url: event.url,
          private: event.private ?? false,
        });
        if (event.index !== undefined && Number.isSafeInteger(event.index))
          useWorkspaceStore.getState().reorderView("", created.id, event.index);
        if (event.focused === false && previousView)
          useWorkspaceStore.getState().focusView(previousView.id);
        if (event.requestId)
          void publishLayout()
            .then(() => extensionsNative.tabCreated(event.requestId!, browserRuntimeId(created)))
            .catch(() => {});
      }
      if (event.kind === "activate-tab" && tab) workspace.focusView(tab.id);
      if (event.kind === "move-tab" && tab && event.index !== undefined)
        workspace.reorderView("", tab.id, event.index);
      if (event.kind === "tab-muted" && tab)
        useBrowserMediaStore.getState().setMutedState(tab.id, Boolean(event.muted));
      if (event.kind === "close-tab" && tab) {
        const previous = workspace.activeWindowId;
        workspace.focusView(tab.id);
        useWorkspaceStore.getState().closeView(tab.id);
        if (previous && useWorkspaceStore.getState().activeWindowId !== previous)
          useWorkspaceStore.getState().switchWindow(previous);
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
