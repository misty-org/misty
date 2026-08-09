import type { ProviderRemote, ProviderWorkflow } from "@/services/misty/model/misty-api";
import { Button } from "@/shared/ui";
import { X } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProviderConnectionDialog } from "./components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "./components/ProviderDisconnectDialog";
import { RemoteEditPanel } from "./components/RemoteEditPanel";
import { RemoteListPanel } from "./components/RemoteListPanel";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderWorkspaceDerived,
  useProvidersStore,
} from "./store";

// Remotes is a single-pane surface. The previous multi-tab workspace was
// removed — there is one remotes pane, so it renders directly with a stable id.
const REMOTES_WORKSPACE_ID = "remotes://root";
const EMPTY_PROVIDER_REMOTES: ProviderRemote[] = [];
const EMPTY_PROVIDER_WORKFLOWS: ProviderWorkflow[] = [];
const EMPTY_PROVIDER_WORKSPACE = createProvidersWorkspaceState();

const providersShellClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg";

const providersPageShellClass = "grid h-full min-h-0 grid-rows-[minmax(0,1fr)] bg-charcoal-bg";

const providersOverlayHeaderClass =
  "flex items-center justify-between gap-3 border-b border-charcoal-border px-4 py-2.5";

const providersPaneContainerClass = "min-h-0 min-w-0 overflow-hidden p-3";

const providersPaneWorkspaceClass =
  "grid h-full min-h-0 min-w-0 grid-cols-[minmax(280px,0.42fr)_minmax(420px,0.58fr)] overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card max-[860px]:grid-cols-[minmax(0,1fr)]";

export const ProvidersWorkspace = memo(function ProvidersWorkspace(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
  const loadProviders = useProvidersStore((state) => state.load);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const overlay = props.presentation === "overlay";

  return (
    <div className={overlay ? providersShellClass : providersPageShellClass}>
      {overlay ? (
        <header className={providersOverlayHeaderClass}>
          <h2 className="text-sm font-medium text-cream">Remotes</h2>
          <Button variant="ghost" size="icon" aria-label="Close remotes" onClick={props.onClose}>
            <X size={16} />
          </Button>
        </header>
      ) : null}

      <div className={providersPaneContainerClass}>
        <ProvidersPane workspaceId={REMOTES_WORKSPACE_ID} />
      </div>

      <ProvidersDialogs />
    </div>
  );
});

export const ProvidersWorkspacePanel = memo(function ProvidersWorkspacePanel(props: {
  workspaceId: string;
}) {
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
  } = useProvidersStore(
    useShallow((state) => ({
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
    })),
  );
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
    loadWorkspaceConfigPaths,
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
    testWorkspaceConnection,
  } = useProvidersStore(
    useShallow((state) => ({
      loading: state.loading,
      providers: state.providers,
      remoteRevisions: state.remoteRevisions,
      remotes: state.providers?.remotes ?? EMPTY_PROVIDER_REMOTES,
      working: state.working,
      workspace: state.workspaces[props.workspaceId] ?? EMPTY_PROVIDER_WORKSPACE,
      ensureWorkspace: state.ensureWorkspace,
      load: state.load,
      loadWorkspaceConfigPaths: state.loadWorkspaceConfigPaths,
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
      testWorkspaceConnection: state.testWorkspaceConnection,
    })),
  );
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
    ? (providers?.workflows.find((workflow) => workflow.type === workspace.draft?.providerType) ??
      null)
    : null;

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
    void loadWorkspaceConfigPaths(props.workspaceId);
  }, [ensureWorkspace, loadWorkspaceConfigPaths, props.workspaceId]);

  // Auto-select the first remote once per pane. Re-running whenever `draft` goes
  // null would fight the dirty guard: discarding or deleting a draft would
  // immediately pull the pane back into the first remote.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    autoSelectedRef.current = false;
  }, [props.workspaceId]);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (loading || workspace.draft || workspace.loadingRemoteName || remotes.length === 0) return;
    autoSelectedRef.current = true;
    void selectRemoteInWorkspace(props.workspaceId, remotes[0].name, false);
  }, [
    loading,
    props.workspaceId,
    remotes,
    selectRemoteInWorkspace,
    workspace.draft,
    workspace.loadingRemoteName,
  ]);

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
        feedbackError={workspace.error}
        feedbackMessage={workspace.message}
        onDraftName={(name) => setWorkspaceDraftName(props.workspaceId, name)}
        onConfigField={(key, value) => setWorkspaceConfigField(props.workspaceId, key, value)}
        onTokenField={(key, value) => setWorkspaceTokenField(props.workspaceId, key, value)}
        onTokenVisible={(visible) => setWorkspaceTokenVisible(props.workspaceId, visible)}
        onSave={() => void saveWorkspaceRemote(props.workspaceId)}
        onDelete={requestDisconnect}
        onTest={() => void testWorkspaceConnection(props.workspaceId)}
        onReload={() => {
          if (
            dirty &&
            !window.confirm("Reload this remote and discard unsaved edits in this pane?")
          )
            return;
          void reloadWorkspaceRemote(props.workspaceId);
        }}
      />
    </section>
  );
});

export default ProvidersWorkspace;
