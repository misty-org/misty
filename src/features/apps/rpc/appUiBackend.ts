import { MistyViewStateSchema, type MistyViewState, commandsForApp } from "@misty/sdk";
import {
  selectGeneralPreferences,
  selectEditorPreferences,
  selectTerminalPreferences,
  useSettingsStore,
} from "@/features/settings";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import {
  detectShortcutPlatform,
  effectiveShortcut,
  formatShortcutLabel,
  registerShortcutHandler,
} from "@/features/shortcuts";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { reportSystemError } from "@/features/activity/systemActivity";
import { AppRpcError, type AppRpcScope } from "./session";
import type { AppUiBackend } from "./appUi";
import { subscribeAppDataChanges } from "./dataEvents";
import { confirmAction } from "@/shared/lib/confirmAction";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { maxWorkspacePanels, type WorkspaceTab } from "@/features/workspace/model";
import { browserHomeUrl } from "@/features/workspace/browserHome";

import { appOwnedRoute } from "../appCapabilityGateway";
import { officialAppSlug } from "../appRoute";

const workspaceRevisions = new Map<string, { users: number; value: number; content: string }>();

export function createAppUiBackend(scope: AppRpcScope): AppUiBackend {
  scope.assert();
  const revisionKey = JSON.stringify([
    scope.identity.accountId,
    scope.identity.spaceId,
    scope.identity.appId,
  ]);
  let revision = workspaceRevisions.get(revisionKey);
  if (!revision) {
    revision = { users: 0, value: 0, content: "" };
    workspaceRevisions.set(revisionKey, revision);
  }
  const clock = revision;
  clock.users++;
  scope.signal.addEventListener(
    "abort",
    () => {
      if (--clock.users === 0 && workspaceRevisions.get(revisionKey) === clock)
        workspaceRevisions.delete(revisionKey);
    },
    { once: true },
  );
  const ownedPane = () => {
    scope.assert();
    const state = useWorkspaceStore.getState();
    if (
      state.activeScopeKey !==
      (scope.identity.spaceId ? `space:${scope.identity.spaceId}` : "global")
    )
      throw new AppRpcError("view_closed", "The App's Space is no longer active.");
    const pane = dockLeaves(state.layout.root).find((pane) =>
      pane.tabs.some((tab) => tab.id === scope.identity.instanceId && isOwned(tab)),
    );
    if (!pane) throw new AppRpcError("view_closed", "The App's workspace view is no longer open.");
    return { state, pane };
  };
  const isOwned = (tab: WorkspaceTab) => {
    if (tab.groupKey !== `app:${scope.identity.appId}`) return false;
    try {
      appOwnedRoute(tab.route, officialAppSlug(scope.identity.appId), scope.identity.spaceId);
      return true;
    } catch {
      return false;
    }
  };
  const target = (viewId: string) => {
    const { state } = ownedPane();
    for (const pane of dockLeaves(state.layout.root)) {
      const tab = pane.tabs.find((tab) => tab.id === viewId && isOwned(tab));
      if (tab) return { state, pane, tab };
    }
    throw new AppRpcError(
      "view_not_owned",
      "The requested view is closed or belongs to another App or Space.",
    );
  };
  const stateFor = (tab: WorkspaceTab): MistyViewState => {
    const stored = (
      tab.state as {
        mistyAppView?: { appId?: string; accountId?: string; spaceId?: string; state?: unknown };
      } | null
    )?.mistyAppView;
    if (
      !stored ||
      stored.appId !== scope.identity.appId ||
      stored.accountId !== scope.identity.accountId ||
      stored.spaceId !== scope.identity.spaceId
    )
      return null;
    const parsed = MistyViewStateSchema.safeParse(stored.state);
    return parsed.success ? (JSON.parse(JSON.stringify(parsed.data)) as MistyViewState) : null;
  };
  const saveState = (hostState: unknown, appState: MistyViewState) => ({
    ...(hostState && typeof hostState === "object" && !Array.isArray(hostState) ? hostState : {}),
    mistyAppView: {
      appId: scope.identity.appId,
      accountId: scope.identity.accountId,
      spaceId: scope.identity.spaceId,
      state: JSON.parse(JSON.stringify(appState)) as MistyViewState,
    },
  });
  return {
    workspaceSnapshot() {
      const { state } = ownedPane();
      const snapshot = {
        views: dockLeaves(state.layout.root).flatMap((pane) =>
          pane.tabs.filter(isOwned).map((tab) => ({
            viewId: tab.id,
            panelId: pane.id,
            route: tab.route,
            title:
              Array.from(tab.title)
                .filter((character) => character >= " " && character !== "\u007f")
                .join("")
                .slice(0, 160) || "App",
            state: stateFor(tab),
            sidebarVisible: tab.sidebarVisible,
            active: pane.activeTabId === tab.id,
            focused: state.layout.focusedPaneId === pane.id && pane.activeTabId === tab.id,
          })),
        ),
      };
      const content = JSON.stringify(snapshot);
      if (content !== clock.content) {
        clock.content = content;
        clock.value++;
      }
      return { ...snapshot, revision: clock.value };
    },
    updateWorkspace(change) {
      const { state, tab } = target(change.viewId);
      if (change.state !== undefined)
        state.updateTabState(tab.id, saveState(tab.state, change.state), change.title);
      else if (change.title !== undefined) state.renameTab(tab.id, change.title);
      if (change.sidebarVisible !== undefined && change.sidebarVisible !== tab.sidebarVisible)
        state.toggleSidebar(tab.id);
    },
    focusWorkspace(viewId) {
      if (!target(viewId).state.focusTab(viewId))
        throw new AppRpcError("view_closed", "The App view could not be focused.");
    },
    closeWorkspace(viewId) {
      if (!target(viewId).state.closeTab(viewId))
        throw new AppRpcError("view_closed", "The App view could not be closed.");
    },
    placeWorkspace({ viewId, targetViewId, placement }) {
      const source = target(viewId),
        destination = target(targetViewId);
      if (source.pane.id === destination.pane.id && placement === "tab") {
        source.state.focusTab(viewId);
        return;
      }
      if (placement !== "tab" && dockLeaves(source.state.layout.root).length >= maxWorkspacePanels)
        throw new AppRpcError("panel_limit", "Close a panel before opening another.");
      if (
        !source.state.dockTab(
          viewId,
          destination.pane.id,
          placement === "tab" ? "center" : placement,
        )
      )
        throw new AppRpcError(
          "panel_unavailable",
          "The App view could not be placed in that panel.",
        );
    },
    subscribeWorkspace(listener) {
      ownedPane();
      let active = true,
        queued = false;
      const remove = useWorkspaceStore.subscribe(() => {
        if (queued || !active) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (active) listener();
        });
      });
      return () => {
        active = false;
        remove();
      };
    },
    openWorkspace({ route, placement = "tab", state: appState, title, sidebarVisible }) {
      const { state, pane } = ownedPane();
      const request = workspaceSurfaceFromRoute(route);
      if (
        !request ||
        request.groupKey !== `app:${scope.identity.appId}` ||
        (request.scopeKey && request.scopeKey !== state.activeScopeKey)
      )
        throw new AppRpcError(
          "invalid_navigation",
          "The requested view is outside this App's workspace.",
        );
      if (placement !== "tab" && dockLeaves(state.layout.root).length >= maxWorkspacePanels)
        throw new AppRpcError("panel_limit", "Close a panel before opening another.");
      if (
        dockLeaves(state.layout.root)
          .flatMap((pane) => pane.tabs)
          .filter(isOwned).length >= 128
      )
        throw new AppRpcError("view_limit", "Close an App view before opening another.");
      const tab = state.addSurface({
        ...request,
        paneId: pane.id,
        forceNew: true,
        ...(appState !== undefined ? { state: saveState(request.state, appState) } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(sidebarVisible !== undefined ? { sidebarVisible } : {}),
      });
      if (placement !== "tab" && !state.splitPane(pane.id, placement, tab.id)) {
        state.closeTab(tab.id);
        state.focusTab(scope.identity.instanceId);
        throw new AppRpcError("panel_unavailable", "The requested panel could not be opened.");
      }
      return { viewId: tab.id };
    },
    confirm: (message, title) => confirmAction(message, title ?? scope.identity.appId),
    setTitle(title) {
      ownedPane().state.renameTab(scope.identity.instanceId, title);
    },
    settings() {
      scope.assert();
      // Never return the whole settings document: it contains other Apps and
      // host configuration. Add each domain's safe fields as its SDK migrates.
      return {
        ...(scope.identity.appId === "code" ? { code: selectEditorPreferences(useSettingsStore.getState().settings?.document) } : {}),
        ...(scope.identity.appId === "browser"
          ? {
              browser: {
                homeUrl: browserHomeUrl(),
                searchEngineIndex:
                  Math.max(
                    0,
                    Math.min(
                      4,
                      Math.trunc(
                        selectGeneralPreferences(useSettingsStore.getState().settings?.document)
                          .searchEngineIndex,
                      ),
                    ),
                  ) || 0,
              },
            }
          : {}),
        ...(scope.identity.appId === "terminal"
          ? {
              terminal: selectTerminalPreferences(useSettingsStore.getState().settings?.document),
            }
          : {}),
        shortcutLabels: Object.fromEntries(
          commandsForApp(scope.identity.appId).map((command) => [
            command,
            formatShortcutLabel(effectiveShortcut(command).primary, detectShortcutPlatform()),
          ]),
        ),
      };
    },
    subscribeSettings: (listener) => useSettingsStore.subscribe(listener),
    subscribeData: (domain, listener) => subscribeAppDataChanges(scope, domain, listener),
    registerShortcut: (command, listener) =>
      registerShortcutHandler(command, listener, () => {
        try {
          const { state, pane } = ownedPane();
          return (
            state.layout.focusedPaneId === pane.id && pane.activeTabId === scope.identity.instanceId
          );
        } catch {
          return false;
        }
      }),
    openExternal: openSystemExternalLink,
    reportError(message) {
      scope.assert();
      reportSystemError({
        accountId: scope.identity.accountId,
        error: message,
        scope: `app:${scope.identity.appId}:${scope.identity.instanceId}`,
        title: `${scope.identity.appId} reported an error`,
      });
    },
  };
}
