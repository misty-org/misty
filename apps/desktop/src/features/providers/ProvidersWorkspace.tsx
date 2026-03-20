import { memo, useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../shared/multipanel/types";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import { createMultiPanelStore, type MultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { RemoteEditPanel } from "./components/RemoteEditPanel";
import { RemoteListPanel } from "./components/RemoteListPanel";
import { ProviderConnectionDialog } from "./components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "./components/ProviderDisconnectDialog";
import type { ProviderRemote, ProviderWorkflow } from "../../api/types";
import { prettyLabel } from "../../shared/format";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderWorkspaceDerived,
  useProvidersStore,
} from "./useProvidersStore";

const useProvidersMultiPanelStore = createMultiPanelStore({ idPrefix: "providers", defaultTitle: "Providers" });
const PROVIDERS_MULTIPANEL_STORAGE_KEY = "misty.providers.multipanel.v1";
const EMPTY_PROVIDER_REMOTES: ProviderRemote[] = [];
const EMPTY_PROVIDER_WORKFLOWS: ProviderWorkflow[] = [];

interface ProvidersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}

export const ProvidersWorkspace = memo(function ProvidersWorkspace() {
  const {
    connection,
    disconnectTarget,
    error,
    message,
    providers,
    working,
    advanceConnection,
    cancelDisconnect,
    chooseConnectionProvider,
    closeConnection,
    confirmDisconnect,
    discardWorkspaces,
    setConnectionName,
    setConnectionParameter,
    submitConnection,
  } = useProvidersStore(useShallow((state) => ({
    connection: state.connection,
    disconnectTarget: state.disconnectTarget,
    error: state.error,
    message: state.message,
    providers: state.providers,
    working: state.working,
    advanceConnection: state.advanceConnection,
    cancelDisconnect: state.cancelDisconnect,
    chooseConnectionProvider: state.chooseConnectionProvider,
    closeConnection: state.closeConnection,
    confirmDisconnect: state.confirmDisconnect,
    discardWorkspaces: state.discardWorkspaces,
    setConnectionName: state.setConnectionName,
    setConnectionParameter: state.setConnectionParameter,
    submitConnection: state.submitConnection,
  })));
  const loadProviders = useProvidersStore((state) => state.load);
  const providerWorkflows = providers?.workflows ?? EMPTY_PROVIDER_WORKFLOWS;

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
    void loadProviders();
  }, [loadProviders]);

  const dirtyPaneIdsForTab = useCallback((tab: MultiPanelTab) => {
    const { workspaces } = useProvidersStore.getState();
    return tab.panes
      .filter((pane) => selectProviderWorkspaceDerived(workspaces[pane.id] ?? createProvidersWorkspaceState()).dirty)
      .map((pane) => pane.id);
  }, []);

  const canCloseTab = useCallback((tab: MultiPanelTab) => {
    const dirtyPaneIds = dirtyPaneIdsForTab(tab);
    if (dirtyPaneIds.length === 0) return true;
    const suffix = dirtyPaneIds.length === 1 ? "this provider pane" : `${dirtyPaneIds.length} provider panes`;
    return window.confirm(`Discard unsaved remote edits in ${suffix} before closing this tab?`);
  }, [dirtyPaneIdsForTab]);

  const canClosePane = useCallback((paneId: string) => {
    const workspace = useProvidersStore.getState().workspaces[paneId] ?? createProvidersWorkspaceState();
    if (!selectProviderWorkspaceDerived(workspace).dirty) return true;
    return window.confirm("Discard unsaved remote edits before closing this provider pane?");
  }, []);

  const discardTabWorkspaces = useCallback((tab: MultiPanelTab) => {
    discardWorkspaces(tab.panes.map((pane) => pane.id));
  }, [discardWorkspaces]);

  const discardPaneWorkspace = useCallback((paneId: string) => {
    discardWorkspaces([paneId]);
  }, [discardWorkspaces]);

  return (
    <>
      {error ? <div className="provider-page-message error" role="alert">{error}</div> : null}
      {message ? <div className="provider-page-message success" role="status">{message}</div> : null}
      <MultiPanelWorkspace
        className="providers-workspace"
        store={useProvidersMultiPanelStore}
        canCloseTab={canCloseTab}
        onDidCloseTab={discardTabWorkspaces}
        canClosePane={canClosePane}
        onDidClosePane={discardPaneWorkspace}
        renderPane={(paneId) => <ProvidersPane workspaceId={paneId} />}
      />

      {connection ? (
        <ProviderConnectionDialog
          session={connection}
          workflows={providerWorkflows}
          onClose={closeConnection}
          onChooseProvider={chooseConnectionProvider}
          onName={setConnectionName}
          onParameter={setConnectionParameter}
          onAdvance={advanceConnection}
          onSubmit={() => void submitConnection()}
        />
      ) : null}

      {disconnectTarget ? (
        <ProviderDisconnectDialog
          remoteName={disconnectTarget}
          working={working}
          onCancel={cancelDisconnect}
          onConfirm={() => void confirmDisconnect()}
        />
      ) : null}
    </>
  );
});

const ProvidersPane = memo(function ProvidersPane(props: { workspaceId: string }) {
  const {
    loading,
    remoteRevisions,
    remotes,
    working,
    workspace,
    ensureWorkspace,
    load,
    openAddRemote,
    openReconnectRemote,
    openRepairRemote,
    reloadWorkspaceRemote,
    requestDisconnect,
    revealWorkspaceConfig,
    saveWorkspaceRemote,
    selectRemoteInWorkspace,
    setWorkspaceConfigField,
    setWorkspaceDraftName,
    setWorkspaceTokenField,
    setWorkspaceTokenVisible,
    testWorkspaceConnection,
  } = useProvidersStore(useShallow((state) => ({
    loading: state.loading,
    remoteRevisions: state.remoteRevisions,
    remotes: state.providers?.remotes ?? EMPTY_PROVIDER_REMOTES,
    working: state.working,
    workspace: state.workspaces[props.workspaceId] ?? createProvidersWorkspaceState(),
    ensureWorkspace: state.ensureWorkspace,
    load: state.load,
    openAddRemote: state.openAddRemote,
    openReconnectRemote: state.openReconnectRemote,
    openRepairRemote: state.openRepairRemote,
    reloadWorkspaceRemote: state.reloadWorkspaceRemote,
    requestDisconnect: state.requestDisconnect,
    revealWorkspaceConfig: state.revealWorkspaceConfig,
    saveWorkspaceRemote: state.saveWorkspaceRemote,
    selectRemoteInWorkspace: state.selectRemoteInWorkspace,
    setWorkspaceConfigField: state.setWorkspaceConfigField,
    setWorkspaceDraftName: state.setWorkspaceDraftName,
    setWorkspaceTokenField: state.setWorkspaceTokenField,
    setWorkspaceTokenVisible: state.setWorkspaceTokenVisible,
    testWorkspaceConnection: state.testWorkspaceConnection,
  })));
  const { dirty, validRemoteName, configKeys } = useMemo(
    () => selectProviderWorkspaceDerived(workspace),
    [workspace],
  );
  const stale = useMemo(
    () => isProviderWorkspaceStale(workspace, remoteRevisions, remotes),
    [remoteRevisions, remotes, workspace],
  );

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
  }, [ensureWorkspace, props.workspaceId]);

  useEffect(() => {
    if (!loading && !workspace.draft && !workspace.loadingRemoteName && remotes.length > 0) {
      void selectRemoteInWorkspace(props.workspaceId, remotes[0].name, false);
    }
  }, [loading, props.workspaceId, remotes, selectRemoteInWorkspace, workspace.draft, workspace.loadingRemoteName]);

  return (
    <section className="providers-pane-workspace">
      <ProviderOverview remotes={remotes} />

      <RemoteListPanel
        remotes={remotes}
        selectedRemoteName={workspace.loadingRemoteName ?? workspace.draft?.originalName ?? null}
        loading={loading}
        working={working}
        onRefresh={() => void load(true)}
        onAdd={openAddRemote}
        onSelectRemote={(name) => void selectRemoteInWorkspace(props.workspaceId, name)}
        onReconnect={openReconnectRemote}
        onRepair={openRepairRemote}
        onDisconnect={requestDisconnect}
      />

      <RemoteEditPanel
        draft={workspace.draft}
        configPaths={workspace.configPaths}
        configKeys={configKeys}
        dirty={dirty}
        loadingRemoteName={workspace.loadingRemoteName}
        working={working}
        tokenVisible={workspace.tokenVisible}
        validRemoteName={validRemoteName}
        stale={stale}
        onDraftName={(name) => setWorkspaceDraftName(props.workspaceId, name)}
        onConfigField={(key, value) => setWorkspaceConfigField(props.workspaceId, key, value)}
        onTokenField={(key, value) => setWorkspaceTokenField(props.workspaceId, key, value)}
        onTokenVisible={(visible) => setWorkspaceTokenVisible(props.workspaceId, visible)}
        onTest={() => void testWorkspaceConnection(props.workspaceId)}
        onReveal={() => void revealWorkspaceConfig(props.workspaceId)}
        onSave={() => void saveWorkspaceRemote(props.workspaceId)}
        onReload={() => {
          if (dirty && !window.confirm("Reload this remote and discard unsaved edits in this pane?")) return;
          void reloadWorkspaceRemote(props.workspaceId);
        }}
      />
    </section>
  );
});

const ProviderOverview = memo(function ProviderOverview(props: { remotes: ProviderRemote[] }) {
  const summary = useMemo(() => {
    const needsAttention = props.remotes.filter((remote) => remote.needsReconnect).length;
    const healthy = props.remotes.length - needsAttention;
    const providerTypes = new Set(props.remotes.map((remote) => remote.type));
    const mostRecentType = props.remotes[0]?.type ? prettyLabel(props.remotes[0].type) : "None";
    return [
      { label: "Configured", value: String(props.remotes.length), detail: "remote connections" },
      { label: "Healthy", value: String(healthy), detail: "ready to browse" },
      { label: "Needs attention", value: String(needsAttention), detail: needsAttention > 0 ? "reconnect required" : "all clear" },
      { label: "Provider types", value: String(providerTypes.size), detail: mostRecentType },
    ];
  }, [props.remotes]);

  return (
    <div className="provider-overview" aria-label="Provider summary">
      {summary.map((item) => (
        <div className="provider-overview-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.detail}</em>
        </div>
      ))}
    </div>
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
