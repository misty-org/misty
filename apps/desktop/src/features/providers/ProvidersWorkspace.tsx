import { memo, useCallback, useEffect } from "react";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../shared/multipanel/types";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import { createMultiPanelStore, type MultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { RemoteEditPanel } from "./components/RemoteEditPanel";
import { RemoteListPanel } from "./components/RemoteListPanel";
import { ProviderConnectionDialog } from "./components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "./components/ProviderDisconnectDialog";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderWorkspaceDerived,
  useProvidersStore,
} from "./useProvidersStore";

const useProvidersMultiPanelStore = createMultiPanelStore({ idPrefix: "providers", defaultTitle: "Providers" });
const PROVIDERS_MULTIPANEL_STORAGE_KEY = "misty.providers.multipanel.v1";

interface ProvidersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}

export const ProvidersWorkspace = memo(function ProvidersWorkspace() {
  const state = useProvidersStore();

  useEffect(() => {
    const multi = useProvidersMultiPanelStore.getState();
    if (multi.tabs.length === 0) {
      const snapshot = loadProvidersMultiPanelSnapshot();
      if (!snapshot || !multi.hydrate(snapshot)) {
        multi.initialize("providers://remotes", "Providers");
      }
    }
    saveProvidersMultiPanelSnapshot(useProvidersMultiPanelStore.getState());
    return useProvidersMultiPanelStore.subscribe(saveProvidersMultiPanelSnapshot);
  }, []);

  useEffect(() => {
    void state.load();
  }, [state.load]);

  const dirtyPaneIdsForTab = useCallback((tab: MultiPanelTab) => (
    tab.panes
      .filter((pane) => selectProviderWorkspaceDerived(state.workspaces[pane.id] ?? createProvidersWorkspaceState()).dirty)
      .map((pane) => pane.id)
  ), [state.workspaces]);

  const canCloseTab = useCallback((tab: MultiPanelTab) => {
    const dirtyPaneIds = dirtyPaneIdsForTab(tab);
    if (dirtyPaneIds.length === 0) return true;
    const suffix = dirtyPaneIds.length === 1 ? "this provider pane" : `${dirtyPaneIds.length} provider panes`;
    return window.confirm(`Discard unsaved remote edits in ${suffix} before closing this tab?`);
  }, [dirtyPaneIdsForTab]);

  const canClosePane = useCallback((paneId: string) => {
    const workspace = state.workspaces[paneId] ?? createProvidersWorkspaceState();
    if (!selectProviderWorkspaceDerived(workspace).dirty) return true;
    return window.confirm("Discard unsaved remote edits before closing this provider pane?");
  }, [state.workspaces]);

  const discardTabWorkspaces = useCallback((tab: MultiPanelTab) => {
    state.discardWorkspaces(tab.panes.map((pane) => pane.id));
  }, [state]);

  const discardPaneWorkspace = useCallback((paneId: string) => {
    state.discardWorkspaces([paneId]);
  }, [state]);

  return (
    <>
      {state.error ? <div className="provider-page-message error" role="alert">{state.error}</div> : null}
      {state.message ? <div className="provider-page-message success" role="status">{state.message}</div> : null}
      <MultiPanelWorkspace
        className="providers-workspace"
        store={useProvidersMultiPanelStore}
        canCloseTab={canCloseTab}
        onDidCloseTab={discardTabWorkspaces}
        canClosePane={canClosePane}
        onDidClosePane={discardPaneWorkspace}
        renderPane={(paneId) => <ProvidersPane workspaceId={paneId} />}
      />

      {state.connection ? (
        <ProviderConnectionDialog
          session={state.connection}
          workflows={state.providers?.workflows ?? []}
          onClose={state.closeConnection}
          onChooseProvider={state.chooseConnectionProvider}
          onName={state.setConnectionName}
          onParameter={state.setConnectionParameter}
          onAdvance={state.advanceConnection}
          onSubmit={() => void state.submitConnection()}
        />
      ) : null}

      {state.disconnectTarget ? (
        <ProviderDisconnectDialog
          remoteName={state.disconnectTarget}
          working={state.working}
          onCancel={state.cancelDisconnect}
          onConfirm={() => void state.confirmDisconnect()}
        />
      ) : null}
    </>
  );
});

const ProvidersPane = memo(function ProvidersPane(props: { workspaceId: string }) {
  const state = useProvidersStore();
  const workspace = state.workspaces[props.workspaceId] ?? createProvidersWorkspaceState();
  const { dirty, validRemoteName, configKeys } = selectProviderWorkspaceDerived(workspace);
  const remotes = state.providers?.remotes ?? [];
  const stale = state.providers ? isProviderWorkspaceStale(workspace, state.remoteRevisions, remotes) : false;

  useEffect(() => {
    state.ensureWorkspace(props.workspaceId);
  }, [props.workspaceId, state.ensureWorkspace]);

  useEffect(() => {
    if (!state.loading && !workspace.draft && !workspace.loadingRemoteName && remotes.length > 0) {
      void state.selectRemoteInWorkspace(props.workspaceId, remotes[0].name, false);
    }
  }, [props.workspaceId, remotes, state, state.loading, workspace.draft, workspace.loadingRemoteName]);

  return (
    <section className="providers-pane-workspace">
      <RemoteListPanel
        remotes={remotes}
        selectedRemoteName={workspace.draft?.originalName ?? null}
        loading={state.loading}
        working={state.working}
        onRefresh={() => void state.load(true)}
        onAdd={state.openAddRemote}
        onSelectRemote={(name) => void state.selectRemoteInWorkspace(props.workspaceId, name)}
        onReconnect={state.openReconnectRemote}
        onRepair={state.openRepairRemote}
        onDisconnect={state.requestDisconnect}
      />

      <RemoteEditPanel
        draft={workspace.draft}
        configPaths={workspace.configPaths}
        configKeys={configKeys}
        dirty={dirty}
        working={state.working}
        tokenVisible={workspace.tokenVisible}
        validRemoteName={validRemoteName}
        stale={stale}
        onDraftName={(name) => state.setWorkspaceDraftName(props.workspaceId, name)}
        onConfigField={(key, value) => state.setWorkspaceConfigField(props.workspaceId, key, value)}
        onTokenField={(key, value) => state.setWorkspaceTokenField(props.workspaceId, key, value)}
        onTokenVisible={(visible) => state.setWorkspaceTokenVisible(props.workspaceId, visible)}
        onTest={() => void state.testWorkspaceConnection(props.workspaceId)}
        onReveal={() => void state.revealWorkspaceConfig(props.workspaceId)}
        onSave={() => void state.saveWorkspaceRemote(props.workspaceId)}
        onReload={() => {
          if (dirty && !window.confirm("Reload this remote and discard unsaved edits in this pane?")) return;
          void state.reloadWorkspaceRemote(props.workspaceId);
        }}
      />
    </section>
  );
});

function snapshotProvidersMultiPanel(state: MultiPanelStore): ProvidersMultiPanelSnapshot {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activePaneId: state.activePaneId,
    closedPanes: state.closedPanes,
    nextPaneIndex: state.nextPaneIndex,
    nextTabIndex: state.nextTabIndex,
  };
}

function saveProvidersMultiPanelSnapshot(state: MultiPanelStore): void {
  if (typeof window === "undefined" || state.tabs.length === 0) return;
  try {
    window.localStorage.setItem(PROVIDERS_MULTIPANEL_STORAGE_KEY, JSON.stringify(snapshotProvidersMultiPanel(state)));
  } catch {
    // Providers remains fully usable if localStorage is unavailable.
  }
}

function loadProvidersMultiPanelSnapshot(): ProvidersMultiPanelSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROVIDERS_MULTIPANEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProvidersMultiPanelSnapshot>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    if (typeof parsed.activeTabId !== "string" || typeof parsed.activePaneId !== "string") return null;
    return {
      tabs: parsed.tabs,
      activeTabId: parsed.activeTabId,
      activePaneId: parsed.activePaneId,
      closedPanes: Array.isArray(parsed.closedPanes) ? parsed.closedPanes : [],
      nextPaneIndex: typeof parsed.nextPaneIndex === "number" ? parsed.nextPaneIndex : 1,
      nextTabIndex: typeof parsed.nextTabIndex === "number" ? parsed.nextTabIndex : 1,
    };
  } catch {
    return null;
  }
}
