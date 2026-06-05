import type { ProviderRemote, ProviderWorkflow } from "@/native/contracts";
import { SystemErrorActivity } from "@/features/activity";
import { Button } from "@/shared/ui";
import { Cloud, Plus, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProviderConnectionDialog } from "./components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "./components/ProviderDisconnectDialog";
import { RemoteEditPanel } from "./components/RemoteEditPanel";
import { RemoteListPanel } from "./components/RemoteListPanel";
import { ProviderLogo } from "./components/ProviderLogo";
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
  "flex items-center justify-between gap-3 border-b border-charcoal-border/70 px-5 py-3.5";

const providersPaneContainerClass = "min-h-0 min-w-0 overflow-hidden p-4";

const providersPaneWorkspaceClass =
  "grid h-full min-h-0 min-w-0 grid-cols-[minmax(300px,0.38fr)_minmax(420px,0.62fr)] overflow-hidden rounded-2xl border border-charcoal-border/70 bg-charcoal-card/55 max-[860px]:grid-cols-[minmax(0,1fr)]";

const providersEmptyClass =
  "grid h-full min-h-0 place-items-center overflow-auto rounded-2xl border border-charcoal-border/70 bg-charcoal-card/45 p-8";

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
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-cream">Connected storage</h2>
            <p className="mt-0.5 text-xs text-cream-muted">
              Bring cloud files into Explorer without leaving Misty.
            </p>
          </div>
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
    actionError,
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
      actionError: state.error,
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
  const providerWorkflows = providers?.workflows ?? EMPTY_PROVIDER_WORKFLOWS;

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

  if (!loading && remotes.length === 0 && !serviceError) {
    return (
      <section className={providersEmptyClass}>
        <div className="grid w-full max-w-xl justify-items-center gap-5 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-charcoal-active text-cream-bright">
            <Cloud size={21} strokeWidth={1.8} />
          </span>
          <div className="grid gap-1.5">
            <h2 className="text-lg font-semibold text-cream">Connect your storage</h2>
            <p className="max-w-md text-sm leading-6 text-cream-muted">
              Add a provider once, then browse, copy, move, and search its files alongside your
              local drives.
            </p>
          </div>
          {providerWorkflows.length > 0 ? (
            <div
              className="flex flex-wrap items-center justify-center gap-2"
              aria-label="Available providers"
            >
              {providerWorkflows.slice(0, 7).map((workflow) => (
                <span
                  key={workflow.type}
                  className="grid size-9 place-items-center rounded-xl border border-charcoal-border/65 bg-charcoal-bg"
                  title={workflow.name || workflow.type}
                >
                  <ProviderLogo type={workflow.type} size={19} />
                </span>
              ))}
            </div>
          ) : null}
          <Button type="button" onClick={() => void openAddRemote()} disabled={working}>
            <Plus size={15} /> Connect provider
          </Button>
          {actionError ? (
            <SystemErrorActivity
              error={actionError}
              scope="files:remotes:connect"
              title="Storage provider could not be connected"
              target={{ kind: "workspace-tool", tool: "files" }}
            />
          ) : null}
          <p className="text-xs text-cream-muted">
            Credentials stay in your system keychain and can be removed at any time.
          </p>
        </div>
      </section>
    );
  }

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
