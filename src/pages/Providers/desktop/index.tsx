import { memo, useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../../shared/multipanel/types";
import { MultiPanelWorkspace } from "../../../shared/multipanel/MultiPanelWorkspace";
import { createMultiPanelStore, type MultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { RemoteEditPanel } from "../components/RemoteEditPanel";
import { RemoteListPanel } from "../components/RemoteListPanel";
import { ProviderConnectionDialog } from "../components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "../components/ProviderDisconnectDialog";
import type { ProviderRemote, ProviderWorkflow } from "../../../api/types";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderWorkspaceDerived,
  useProvidersStore,
} from "../../../stores/useProvidersStore";

const useProvidersMultiPanelStore = createMultiPanelStore({ idPrefix: "remotes", defaultTitle: "Remotes" });
const PROVIDERS_MULTIPANEL_STORAGE_KEY = "misty.remotes.multipanel.v1";
const EMPTY_PROVIDER_REMOTES: ProviderRemote[] = [];
const EMPTY_PROVIDER_WORKFLOWS: ProviderWorkflow[] = [];

const providersWorkspaceClass =
  "h-full bg-[var(--misty-app-page-bg,var(--misty-bg))]";

const providersPaneWorkspaceClass =
  "grid h-full min-h-0 min-w-0 grid-cols-[minmax(280px,0.42fr)_minmax(420px,0.58fr)] overflow-hidden bg-transparent max-[860px]:grid-cols-[minmax(0,1fr)]";

interface ProvidersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}

export const ProvidersWorkspace = memo(function ProvidersWorkspace() {
  const discardWorkspaces = useProvidersStore((state) => state.discardWorkspaces);
  const loadProviders = useProvidersStore((state) => state.load);

  useEffect(() => {
    const multi = useProvidersMultiPanelStore.getState();
    if (multi.tabs.length === 0) {
      const snapshot = loadProvidersMultiPanelSnapshot();
      if (!snapshot || !multi.hydrate(snapshot)) {
        multi.initialize("remotes://root", "Remotes");
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
    const suffix = dirtyPaneIds.length === 1 ? "this remote pane" : `${dirtyPaneIds.length} remote panes`;
    return window.confirm(`Discard unsaved remote edits in ${suffix} before closing this tab?`);
  }, [dirtyPaneIdsForTab]);

  const canClosePane = useCallback((paneId: string) => {
    const workspace = useProvidersStore.getState().workspaces[paneId] ?? createProvidersWorkspaceState();
    if (!selectProviderWorkspaceDerived(workspace).dirty) return true;
    return window.confirm("Discard unsaved remote edits before closing this remote pane?");
  }, []);

  const discardTabWorkspaces = useCallback((tab: MultiPanelTab) => {
    discardWorkspaces(tab.panes.map((pane) => pane.id));
  }, [discardWorkspaces]);

  const discardPaneWorkspace = useCallback((paneId: string) => {
    discardWorkspaces([paneId]);
  }, [discardWorkspaces]);

  return (
    <>
      <MultiPanelWorkspace
        className={providersWorkspaceClass}
        store={useProvidersMultiPanelStore}
        canCloseTab={canCloseTab}
        onDidCloseTab={discardTabWorkspaces}
        canClosePane={canClosePane}
        onDidClosePane={discardPaneWorkspace}
        renderPane={(paneId) => <ProvidersPane workspaceId={paneId} />}
      />

      <ProvidersDialogs />
    </>
  );
});

export const ProvidersWorkspacePanel = memo(function ProvidersWorkspacePanel(props: { workspaceId: string }) {
  const loadProviders = useProvidersStore((state) => state.load);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  return (
    <>
      <ProvidersPane workspaceId={props.workspaceId} />
      <ProvidersDialogs />
    </>
  );
});

const ProvidersDialogs = memo(function ProvidersDialogs() {
  const {
    connection,
    disconnectTarget,
    providers,
    working,
    advanceConnection,
    cancelDisconnect,
    chooseConnectionProvider,
    closeConnection,
    confirmDisconnect,
    reopenConnectionAuthorization,
    setConnectionName,
    setConnectionParameter,
    submitConnection,
  } = useProvidersStore(useShallow((state) => ({
    connection: state.connection,
    disconnectTarget: state.disconnectTarget,
    providers: state.providers,
    working: state.working,
    advanceConnection: state.advanceConnection,
    cancelDisconnect: state.cancelDisconnect,
    chooseConnectionProvider: state.chooseConnectionProvider,
    closeConnection: state.closeConnection,
    confirmDisconnect: state.confirmDisconnect,
    reopenConnectionAuthorization: state.reopenConnectionAuthorization,
    setConnectionName: state.setConnectionName,
    setConnectionParameter: state.setConnectionParameter,
    submitConnection: state.submitConnection,
  })));
  const providerWorkflows = providers?.workflows ?? EMPTY_PROVIDER_WORKFLOWS;

  return (
    <>
      {connection ? (
        <ProviderConnectionDialog
          session={connection}
          workflows={providerWorkflows}
          onClose={closeConnection}
          onChooseProvider={chooseConnectionProvider}
          onName={setConnectionName}
          onParameter={setConnectionParameter}
          onAdvance={advanceConnection}
          onSubmit={(polling) => void submitConnection(polling)}
          onOpenAuthorize={() => void reopenConnectionAuthorization()}
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
    providers,
    remoteRevisions,
    remotes,
    working,
    workspace,
    ensureWorkspace,
    load,
    openAddRemote,
    openRepairRemote,
    reloadWorkspaceRemote,
    requestDisconnect,
    saveWorkspaceRemote,
    selectRemoteInWorkspace,
    setWorkspaceConfigField,
    setWorkspaceDraftName,
    setWorkspaceTokenField,
    setWorkspaceTokenVisible,
  } = useProvidersStore(useShallow((state) => ({
    loading: state.loading,
    providers: state.providers,
    remoteRevisions: state.remoteRevisions,
    remotes: state.providers?.remotes ?? EMPTY_PROVIDER_REMOTES,
    working: state.working,
    workspace: state.workspaces[props.workspaceId] ?? createProvidersWorkspaceState(),
    ensureWorkspace: state.ensureWorkspace,
    load: state.load,
    openAddRemote: state.openAddRemote,
    openRepairRemote: state.openRepairRemote,
    reloadWorkspaceRemote: state.reloadWorkspaceRemote,
    requestDisconnect: state.requestDisconnect,
    saveWorkspaceRemote: state.saveWorkspaceRemote,
    selectRemoteInWorkspace: state.selectRemoteInWorkspace,
    setWorkspaceConfigField: state.setWorkspaceConfigField,
    setWorkspaceDraftName: state.setWorkspaceDraftName,
    setWorkspaceTokenField: state.setWorkspaceTokenField,
    setWorkspaceTokenVisible: state.setWorkspaceTokenVisible,
  })));
  const { dirty, validRemoteName, configKeys } = useMemo(
    () => selectProviderWorkspaceDerived(workspace),
    [workspace],
  );
  const stale = useMemo(
    () => isProviderWorkspaceStale(workspace, remoteRevisions, remotes),
    [remoteRevisions, remotes, workspace],
  );
  const serviceError = providers?.error ?? providers?.health.error ?? null;
  const selectedWorkflow = workspace.draft
    ? providers?.workflows.find((workflow) => workflow.type === workspace.draft?.providerType) ?? null
    : null;

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
  }, [ensureWorkspace, props.workspaceId]);

  useEffect(() => {
    if (!loading && !workspace.draft && !workspace.loadingRemoteName && remotes.length > 0) {
      void selectRemoteInWorkspace(props.workspaceId, remotes[0].name, false);
    }
  }, [loading, props.workspaceId, remotes, selectRemoteInWorkspace, workspace.draft, workspace.loadingRemoteName]);

  return (
    <section className={providersPaneWorkspaceClass}>
      <RemoteListPanel
        remotes={remotes}
        selectedRemoteName={workspace.loadingRemoteName ?? workspace.draft?.originalName ?? null}
        loading={loading}
        serviceError={serviceError}
        working={working}
        onRefresh={() => void load(true)}
        onAdd={openAddRemote}
        onSelectRemote={(name) => void selectRemoteInWorkspace(props.workspaceId, name)}
        onRepair={openRepairRemote}
        onDisconnect={requestDisconnect}
      />

      <RemoteEditPanel
        draft={workspace.draft}
        configPaths={workspace.configPaths}
        configKeys={configKeys}
        workflow={selectedWorkflow}
        dirty={dirty}
        loadingRemoteName={workspace.loadingRemoteName}
        working={working}
        tokenVisible={workspace.tokenVisible}
        validRemoteName={validRemoteName}
        stale={stale}
        serviceError={serviceError}
        onDraftName={(name) => setWorkspaceDraftName(props.workspaceId, name)}
        onConfigField={(key, value) => setWorkspaceConfigField(props.workspaceId, key, value)}
        onTokenField={(key, value) => setWorkspaceTokenField(props.workspaceId, key, value)}
        onTokenVisible={(visible) => setWorkspaceTokenVisible(props.workspaceId, visible)}
        onSave={() => void saveWorkspaceRemote(props.workspaceId)}
        onDelete={requestDisconnect}
        onReload={() => {
          if (dirty && !window.confirm("Reload this remote and discard unsaved edits in this pane?")) return;
          void reloadWorkspaceRemote(props.workspaceId);
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
    // Remotes remains fully usable if localStorage is unavailable.
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

export default ProvidersWorkspace;
