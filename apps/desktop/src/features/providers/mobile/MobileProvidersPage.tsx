import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderPlus,
  PlugZap,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
  Wrench,
  X,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ProviderRemote, ProviderWorkflow, ProviderWorkflowOption, RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { prettyLabel } from "../../../shared/format";
import { isSecretKey, parseTokenFields, providerOptionsForConnection } from "../providerUtils";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderDerived,
  selectProviderWorkspaceDerived,
  useProvidersStore,
  type ProviderConnectionSession,
  type ProvidersWorkspaceState,
} from "../useProvidersStore";

const EMPTY_REMOTES: ProviderRemote[] = [];
const EMPTY_WORKFLOWS: ProviderWorkflow[] = [];
const mobileProviderWorkspaceId = "mobile-providers";

export function MobileProvidersPage() {
  const {
    providers,
    remotes,
    workflows,
    status,
    loading,
    working,
    error,
    message,
    connection,
    disconnectTarget,
    workspaces,
    remoteRevisions,
    load,
    ensureWorkspace,
    openAddRemote,
    openReconnectRemote,
    openRepairRemote,
    closeConnection,
    chooseConnectionProvider,
    setConnectionName,
    setConnectionParameter,
    advanceConnection,
    submitConnection,
    reopenConnectionAuthorization,
    selectRemoteInWorkspace,
    reloadWorkspaceRemote,
    setWorkspaceDraftName,
    setWorkspaceConfigField,
    setWorkspaceTokenField,
    setWorkspaceTokenVisible,
    testWorkspaceConnection,
    revealWorkspaceConfig,
    saveWorkspaceRemote,
    requestDisconnect,
    cancelDisconnect,
    confirmDisconnect,
  } = useProvidersStore(useShallow((state) => ({
    providers: state.providers,
    remotes: state.providers?.remotes ?? EMPTY_REMOTES,
    workflows: state.providers?.workflows ?? EMPTY_WORKFLOWS,
    status: selectProviderDerived(state).status,
    loading: state.loading,
    working: state.working,
    error: state.error,
    message: state.message,
    connection: state.connection,
    disconnectTarget: state.disconnectTarget,
    workspaces: state.workspaces,
    remoteRevisions: state.remoteRevisions,
    load: state.load,
    ensureWorkspace: state.ensureWorkspace,
    openAddRemote: state.openAddRemote,
    openReconnectRemote: state.openReconnectRemote,
    openRepairRemote: state.openRepairRemote,
    closeConnection: state.closeConnection,
    chooseConnectionProvider: state.chooseConnectionProvider,
    setConnectionName: state.setConnectionName,
    setConnectionParameter: state.setConnectionParameter,
    advanceConnection: state.advanceConnection,
    submitConnection: state.submitConnection,
    reopenConnectionAuthorization: state.reopenConnectionAuthorization,
    selectRemoteInWorkspace: state.selectRemoteInWorkspace,
    reloadWorkspaceRemote: state.reloadWorkspaceRemote,
    setWorkspaceDraftName: state.setWorkspaceDraftName,
    setWorkspaceConfigField: state.setWorkspaceConfigField,
    setWorkspaceTokenField: state.setWorkspaceTokenField,
    setWorkspaceTokenVisible: state.setWorkspaceTokenVisible,
    testWorkspaceConnection: state.testWorkspaceConnection,
    revealWorkspaceConfig: state.revealWorkspaceConfig,
    saveWorkspaceRemote: state.saveWorkspaceRemote,
    requestDisconnect: state.requestDisconnect,
    cancelDisconnect: state.cancelDisconnect,
    confirmDisconnect: state.confirmDisconnect,
  })));
  const [managedRemoteName, setManagedRemoteName] = useState<string | null>(null);

  useEffect(() => {
    ensureWorkspace(mobileProviderWorkspaceId);
    void load(false);
  }, [ensureWorkspace, load]);

  const health = providers?.health ?? null;
  const providerCount = health?.availableProviders ?? workflows.length;
  const connectedCount = health?.connectedProviders ?? remotes.length;
  const workspace = workspaces[mobileProviderWorkspaceId] ?? createProvidersWorkspaceState();
  const workspaceDerived = useMemo(() => selectProviderWorkspaceDerived(workspace), [workspace]);
  const stale = useMemo(
    () => isProviderWorkspaceStale(workspace, remoteRevisions, remotes),
    [remoteRevisions, remotes, workspace],
  );
  const managedRemote = managedRemoteName
    ? remotes.find((remote) => remote.name === managedRemoteName) ?? null
    : null;

  const closeManageSheet = () => {
    if (workspaceDerived.dirty && !window.confirm("Discard unsaved remote edits?")) return;
    setManagedRemoteName(null);
  };

  const openManageSheet = (remote: ProviderRemote) => {
    setManagedRemoteName(remote.name);
    void selectRemoteInWorkspace(mobileProviderWorkspaceId, remote.name);
  };

  return (
    <section className="mobile-page mobile-providers-page">
      <div className="mobile-provider-hero">
        <div className="mobile-provider-hero-icon">
          <Cloud size={31} strokeWidth={1.75} />
        </div>
        <div>
          <span>Cloud access</span>
          <h2>{connectedCount > 0 ? `${connectedCount} connected` : "Connect providers"}</h2>
          <p>{status}</p>
        </div>
      </div>

      {error ? <div className="mobile-error">{error}</div> : null}
      {message ? <div className="mobile-success">{message}</div> : null}

      <div className="mobile-summary-grid">
        <SummaryTile label="Service" value={health?.ready ? "Ready" : "Unavailable"} tone={health?.ready ? "good" : "warn"} />
        <SummaryTile label="Connected" value={`${connectedCount}`} tone={connectedCount > 0 ? "good" : undefined} />
        <SummaryTile label="Available" value={`${providerCount}`} />
        <SummaryTile label="Version" value={health?.version || "Unknown"} />
      </div>

      <div className="mobile-action-stack">
        <button
          type="button"
          className="mobile-primary-action"
          disabled={working}
          onClick={() => void openAddRemote()}
        >
          <FolderPlus size={18} /> Connect provider
        </button>
        <button
          type="button"
          className="mobile-secondary-action"
          disabled={loading || working}
          onClick={() => void load(true)}
        >
          <RefreshCcw className={loading ? "spin" : undefined} size={17} /> Refresh
        </button>
      </div>

      <section className="mobile-provider-section">
        <div className="mobile-section-header">
          <div>
            <span>Remotes</span>
            <h2>Your providers</h2>
          </div>
        </div>

        {loading && remotes.length === 0 ? (
          <div className="mobile-provider-list">
            <div className="mobile-provider-card skeleton" />
            <div className="mobile-provider-card skeleton" />
          </div>
        ) : remotes.length > 0 ? (
          <div className="mobile-provider-list">
            {remotes.map((remote) => (
              <MobileRemoteCard
                key={remote.name}
                remote={remote}
                disabled={working || Boolean(connection)}
                onReconnect={() => void openReconnectRemote(remote)}
                onRepair={() => void openRepairRemote(remote)}
                onManage={() => openManageSheet(remote)}
              />
            ))}
          </div>
        ) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-icon">
              <PlugZap size={31} strokeWidth={1.7} />
            </div>
            <h3>No providers yet</h3>
            <p>Connect a cloud provider to browse it from Files.</p>
          </div>
        )}
      </section>

      {connection ? (
        <MobileProviderConnectionSheet
          session={connection}
          workflows={workflows}
          onClose={closeConnection}
          onChooseProvider={(providerType) => {
            chooseConnectionProvider(providerType);
            advanceConnection();
          }}
          onBackToProvider={() => {
            closeConnection();
            void openAddRemote();
          }}
          onName={setConnectionName}
          onParameter={setConnectionParameter}
          onSubmit={(polling) => void submitConnection(polling)}
          onOpenAuthorize={() => void reopenConnectionAuthorization()}
        />
      ) : null}

      {managedRemoteName ? (
        <MobileRemoteManageSheet
          remote={managedRemote}
          workspace={workspace}
          configKeys={workspaceDerived.configKeys}
          dirty={workspaceDerived.dirty}
          validRemoteName={workspaceDerived.validRemoteName}
          stale={stale}
          working={working}
          onClose={closeManageSheet}
          onDraftName={(name) => setWorkspaceDraftName(mobileProviderWorkspaceId, name)}
          onConfigField={(key, value) => setWorkspaceConfigField(mobileProviderWorkspaceId, key, value)}
          onTokenField={(key, value) => setWorkspaceTokenField(mobileProviderWorkspaceId, key, value)}
          onTokenVisible={(visible) => setWorkspaceTokenVisible(mobileProviderWorkspaceId, visible)}
          onReconnect={(remote) => void openReconnectRemote(remote)}
          onRepair={(remote) => void openRepairRemote(remote)}
          onDisconnect={(name) => requestDisconnect(name)}
          onTest={() => void testWorkspaceConnection(mobileProviderWorkspaceId)}
          onReveal={() => void revealWorkspaceConfig(mobileProviderWorkspaceId)}
          onSave={() => void saveWorkspaceRemote(mobileProviderWorkspaceId)}
          onReload={() => {
            if (workspaceDerived.dirty && !window.confirm("Reload this remote and discard unsaved edits?")) return;
            void reloadWorkspaceRemote(mobileProviderWorkspaceId);
          }}
        />
      ) : null}

      {disconnectTarget ? (
        <MobileProviderDisconnectSheet
          remoteName={disconnectTarget}
          working={working}
          onClose={cancelDisconnect}
          onConfirm={() => void confirmDisconnect()}
        />
      ) : null}
    </section>
  );
}

function MobileRemoteCard(props: {
  remote: ProviderRemote;
  disabled: boolean;
  onReconnect: () => void;
  onRepair: () => void;
  onManage: () => void;
}) {
  const providerIcon = providerIconForType(props.remote.type);
  const healthy = !props.remote.needsReconnect && !props.remote.error;
  const issueMessage = providerIssueMessage(props.remote);
  return (
    <article className={`mobile-provider-card ${healthy ? "healthy" : "warning"}`}>
      <div className="mobile-provider-card-main">
        <span className="mobile-provider-mark">
          <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
        </span>
        <div>
          <strong>{props.remote.name}</strong>
          <small>{props.remote.type}</small>
        </div>
      </div>
      <div className="mobile-provider-status">
        {healthy ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
        <span>{props.remote.statusLabel}</span>
      </div>
      {issueMessage ? <p className="mobile-provider-issue">{issueMessage}</p> : null}
      <div className="mobile-provider-actions">
        <button type="button" disabled={props.disabled} onClick={props.onManage}>
          <Wrench size={15} /> Manage
        </button>
        {props.remote.needsReconnect ? (
          <button type="button" disabled={props.disabled} onClick={props.onReconnect}>
            <RefreshCcw size={15} /> Reconnect
          </button>
        ) : null}
        <button type="button" disabled={props.disabled} onClick={props.onRepair}>
          <Wrench size={15} /> Configure
        </button>
      </div>
    </article>
  );
}

function MobileRemoteManageSheet(props: {
  remote: ProviderRemote | null;
  workspace: ProvidersWorkspaceState;
  configKeys: string[];
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  working: boolean;
  onClose: () => void;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
  onReconnect: (remote: ProviderRemote) => void;
  onRepair: (remote: ProviderRemote) => void;
  onDisconnect: (name: string) => void;
  onTest: () => void;
  onReveal: () => void;
  onSave: () => void;
  onReload: () => void;
}) {
  const loading = Boolean(props.workspace.loadingRemoteName);
  const draft = props.workspace.draft;
  const remote = props.remote;
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-detail-sheet mobile-provider-manage-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={draft ? `Manage ${draft.name}` : "Manage remote"}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{loading ? "Loading" : "Remote"}</span>
            <h2>{loading ? props.workspace.loadingRemoteName : draft?.name ?? remote?.name ?? "Remote"}</h2>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Close" disabled={props.working} onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>

        {loading ? (
          <div className="mobile-provider-card skeleton" />
        ) : draft ? (
          <>
            <div className="mobile-provider-manage-status">
              {props.stale ? <span className="warn">Stale</span> : null}
              {props.dirty ? <span>Unsaved</span> : null}
              {!props.dirty && !props.stale ? <span className="good">Saved</span> : null}
            </div>

            {props.stale ? (
              <div className="mobile-error">
                This remote changed elsewhere. Reload before saving.
              </div>
            ) : null}

            <MobileRemoteConfigForm
              draft={draft}
              configKeys={props.configKeys}
              configPaths={props.workspace.configPaths}
              tokenVisible={props.workspace.tokenVisible}
              onDraftName={props.onDraftName}
              onConfigField={props.onConfigField}
              onTokenField={props.onTokenField}
              onTokenVisible={props.onTokenVisible}
            />

            <div className="mobile-provider-manage-actions">
              <button type="button" disabled={props.working} onClick={props.onTest}>
                <Cloud size={16} /> Test
              </button>
              <button type="button" disabled={props.working} onClick={props.onReveal}>
                <FileText size={16} /> Config
              </button>
              <button
                type="button"
                disabled={props.working || props.stale || !props.dirty || !props.validRemoteName}
                onClick={props.onSave}
              >
                <Save size={16} /> Save
              </button>
              <button type="button" disabled={props.working} onClick={props.onReload}>
                <RefreshCcw size={16} /> Reload
              </button>
              {remote ? (
                <>
                  <button type="button" disabled={props.working} onClick={() => props.onRepair(remote)}>
                    <Wrench size={16} /> Repair
                  </button>
                  <button type="button" disabled={props.working} onClick={() => props.onReconnect(remote)}>
                    <RefreshCcw size={16} /> Reconnect
                  </button>
                </>
              ) : null}
              <button type="button" className="danger" disabled={props.working} onClick={() => props.onDisconnect(draft.originalName)}>
                <Unplug size={16} /> Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className="mobile-empty-state compact">
            <div className="mobile-empty-icon">
              <Cloud size={28} strokeWidth={1.7} />
            </div>
            <h3>Remote unavailable</h3>
            <p>Refresh Remotes and try again.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function MobileRemoteConfigForm(props: {
  draft: RemoteEditDraft;
  configKeys: string[];
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}) {
  return (
    <div className="mobile-provider-edit-form">
      <label className="mobile-input-group">
        <span>Name</span>
        <input value={props.draft.name} onChange={(event) => props.onDraftName(event.target.value)} />
      </label>
      <label className="mobile-input-group">
        <span>Type</span>
        <input value={props.draft.providerType || props.draft.config.type || ""} readOnly />
      </label>
      {props.configKeys.map((key) => (
        <MobileRemoteConfigField
          key={key}
          configKey={key}
          value={props.draft.config[key] ?? ""}
          tokenVisible={props.tokenVisible}
          onConfigField={props.onConfigField}
          onTokenField={props.onTokenField}
          onTokenVisible={props.onTokenVisible}
        />
      ))}
      {props.configPaths ? (
        <div className="mobile-provider-config-paths">
          <div><span>Config</span><strong>{props.configPaths.configPath ?? "--"}</strong></div>
          <div><span>Cache</span><strong>{props.configPaths.cachePath ?? "--"}</strong></div>
          <div><span>Temp</span><strong>{props.configPaths.tempPath ?? "--"}</strong></div>
        </div>
      ) : null}
    </div>
  );
}

function MobileRemoteConfigField(props: {
  configKey: string;
  value: string;
  tokenVisible: boolean;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}) {
  if (props.configKey === "token") {
    const fields = parseTokenFields(props.value);
    if (fields.length > 0) {
      return (
        <fieldset className="mobile-provider-token-fields">
          <legend>
            <span>Authentication</span>
            <button type="button" onClick={() => props.onTokenVisible(!props.tokenVisible)}>
              {props.tokenVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              {props.tokenVisible ? "Hide" : "Show"}
            </button>
          </legend>
          {fields.map((field) => (
            <label key={field.key} className="mobile-input-group">
              <span>{prettyLabel(field.key)}</span>
              <input
                value={field.value}
                type={field.sensitive && !props.tokenVisible ? "password" : "text"}
                onChange={(event) => props.onTokenField(field.key, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
      );
    }
  }

  return (
    <label className="mobile-input-group">
      <span>{prettyLabel(props.configKey)}</span>
      <input
        value={props.value}
        type={isSecretKey(props.configKey) ? "password" : "text"}
        onChange={(event) => props.onConfigField(props.configKey, event.target.value)}
      />
    </label>
  );
}

function MobileProviderDisconnectSheet(props: {
  remoteName: string;
  working: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-detail-sheet mobile-provider-disconnect-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Disconnect ${props.remoteName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Disconnect</span>
            <h2>{props.remoteName}</h2>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Close" disabled={props.working} onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>
        <p className="mobile-file-action-note">
          This removes the remote from Misty. Files already on the provider are not deleted.
        </p>
        <div className="mobile-action-stack">
          <button type="button" className="mobile-secondary-action danger" disabled={props.working} onClick={props.onConfirm}>
            <Trash2 size={17} /> {props.working ? "Disconnecting..." : "Disconnect"}
          </button>
          <button type="button" className="mobile-secondary-action" disabled={props.working} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileProviderConnectionSheet(props: {
  session: ProviderConnectionSession;
  workflows: ProviderWorkflow[];
  onClose: () => void;
  onChooseProvider: (providerType: string) => void;
  onBackToProvider: () => void;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
  onSubmit: (polling?: boolean) => void;
  onOpenAuthorize: () => void;
}) {
  const workflow = workflowForType(props.workflows, props.session.providerType);
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-detail-sheet mobile-provider-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle(props.session)}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{sheetStepLabel(props.session)}</span>
            <h2>{sheetTitle(props.session)}</h2>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label="Close provider setup"
            disabled={props.session.inFlight}
            onClick={props.onClose}
          >
            <X size={18} strokeWidth={1.9} />
          </button>
        </header>

        <MobileProviderProgress session={props.session} />

        {props.session.stage === "provider" ? (
          <ProviderPicker workflows={props.workflows} onChooseProvider={props.onChooseProvider} />
        ) : null}

        {props.session.stage === "configure" ? (
          <ProviderConfiguration
            session={props.session}
            workflow={workflow}
            onBack={props.session.mode === "add" ? props.onBackToProvider : undefined}
            onName={props.onName}
            onParameter={props.onParameter}
          />
        ) : null}

        {props.session.stage === "authorize" ? (
          <ProviderAuthorizeState session={props.session} onOpenAuthorize={props.onOpenAuthorize} />
        ) : null}

        {props.session.stage === "complete" ? (
          <div className="mobile-provider-complete">
            <div className="mobile-empty-icon success">
              <ShieldCheck size={31} strokeWidth={1.7} />
            </div>
            <h3>Provider connected</h3>
            <p>{props.session.remoteName} is ready in Files.</p>
          </div>
        ) : null}

        {props.session.error ? <div className="mobile-error">{props.session.error}</div> : null}

        <div className="mobile-action-stack">
          {props.session.stage === "configure" ? (
            <button
              type="button"
              className="mobile-primary-action"
              disabled={props.session.inFlight}
              onClick={() => props.onSubmit(false)}
            >
              <ShieldCheck className={props.session.inFlight ? "spin" : undefined} size={18} />
              {submitLabel(props.session)}
            </button>
          ) : null}
          {props.session.stage === "authorize" ? (
            <button
              type="button"
              className="mobile-primary-action"
              disabled={props.session.inFlight}
              onClick={() => props.onSubmit(true)}
            >
              <RefreshCcw className={props.session.inFlight ? "spin" : undefined} size={18} />
              {props.session.inFlight ? "Checking..." : "Check authorization"}
            </button>
          ) : null}
          {props.session.stage === "complete" ? (
            <button type="button" className="mobile-primary-action" onClick={props.onClose}>
              Done
            </button>
          ) : null}
          {props.session.stage !== "complete" ? (
            <button
              type="button"
              className="mobile-secondary-action"
              disabled={props.session.inFlight}
              onClick={props.onClose}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ProviderPicker(props: {
  workflows: ProviderWorkflow[];
  onChooseProvider: (providerType: string) => void;
}) {
  if (props.workflows.length === 0) {
    return (
      <div className="mobile-empty-state compact">
        <div className="mobile-empty-icon">
          <Cloud size={28} strokeWidth={1.7} />
        </div>
        <h3>No provider workflows</h3>
        <p>Refresh Providers and make sure the Misty proxy is running.</p>
      </div>
    );
  }

  return (
    <div className="mobile-provider-workflows">
      {props.workflows.map((workflow) => {
        const providerIcon = providerIconForType(workflow.type);
        return (
          <button
            key={workflow.type}
            type="button"
            className="mobile-provider-workflow"
            onClick={() => props.onChooseProvider(workflow.type)}
          >
            <span className="mobile-provider-mark">
              <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
            </span>
            <span>
              <strong>{workflow.name || workflow.type}</strong>
              <small>{workflow.description || workflow.type}</small>
            </span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        );
      })}
    </div>
  );
}

function ProviderConfiguration(props: {
  session: ProviderConnectionSession;
  workflow: ProviderWorkflow | null;
  onBack?: () => void;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
}) {
  const options = providerOptionsForConnection(props.session, props.workflow);
  return (
    <div className="mobile-provider-form">
      {props.onBack ? (
        <button type="button" className="mobile-provider-back" onClick={props.onBack}>
          <ArrowLeft size={16} /> Providers
        </button>
      ) : null}
      <label className="mobile-input-group">
        <span>Remote name</span>
        <input
          value={props.session.remoteName}
          readOnly={props.session.mode !== "add"}
          onChange={(event) => props.onName(event.target.value)}
        />
      </label>
      <div className="mobile-provider-summary">
        <span>Provider</span>
        <strong>{props.workflow?.name || props.session.providerType}</strong>
      </div>
      {options.map((option) => (
        <ProviderOptionField
          key={option.name}
          option={option}
          value={props.session.parameters[option.name] ?? ""}
          onChange={(value) => props.onParameter(option.name, value)}
        />
      ))}
      {props.session.step?.instructions ? <p className="mobile-footnote">{props.session.step.instructions}</p> : null}
    </div>
  );
}

function ProviderOptionField(props: {
  option: ProviderWorkflowOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const { option } = props;
  return (
    <label className="mobile-input-group">
      <span>{option.label || option.name}{option.required ? " *" : ""}</span>
      {option.choices.length > 0 ? (
        <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.help || choice.value}</option>
          ))}
        </select>
      ) : (
        <input
          value={props.value}
          type={option.password ? "password" : "text"}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {option.help ? <small>{option.help}</small> : null}
    </label>
  );
}

function ProviderAuthorizeState(props: {
  session: ProviderConnectionSession;
  onOpenAuthorize: () => void;
}) {
  const authorizeUrl = props.session.step?.authorizeUrl ?? "";
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function copyAuthorizeUrl() {
    if (!authorizeUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(authorizeUrl);
      } else {
        await writeText(authorizeUrl);
      }
      setCopyStatus("Copied");
    } catch {
      try {
        await writeText(authorizeUrl);
        setCopyStatus("Copied");
      } catch {
        setCopyStatus("Copy failed");
      }
    }
  }

  return (
    <div className="mobile-provider-authorize">
      <div className="mobile-empty-icon">
        <ExternalLink size={30} strokeWidth={1.7} />
      </div>
      <h3>Finish provider sign in</h3>
      <p>{props.session.step?.instructions || "Misty opened the provider sign-in page and is waiting for authorization."}</p>
      <small>
        {props.session.polling
          ? `Checking authorization${props.session.authPollAttempts > 0 ? ` (${props.session.authPollAttempts})` : ""}...`
          : "Return here after sign in finishes."}
      </small>
      {props.session.step?.authorizeUrl ? (
        <button type="button" className="mobile-secondary-action" onClick={props.onOpenAuthorize}>
          <ExternalLink size={16} /> {props.session.openedAuthorizeUrl ? "Reopen sign in" : "Open sign in"}
        </button>
      ) : null}
      <div className="mobile-provider-auth-debug">
        <div className="mobile-debug-event">
          <strong>Provider auth debug</strong>
          <p>Attempts: {props.session.authorizeOpenAttempts}</p>
          <p>URL: {authorizeUrl ? "present" : "missing"}</p>
          {props.session.authorizeOpenResult ? (
            <>
              <p>Platform: {props.session.authorizeOpenResult.platform}</p>
              <p>Opened with: {props.session.authorizeOpenResult.strategy}</p>
              <time>{formatDebugTime(props.session.authorizeOpenResult.attemptedAt)}</time>
              {props.session.authorizeOpenResult.fallbackReason ? (
                <code>{props.session.authorizeOpenResult.fallbackReason}</code>
              ) : null}
            </>
          ) : null}
          {props.session.authorizeOpenError ? <code>{props.session.authorizeOpenError}</code> : null}
          {authorizeUrl ? <code>{authorizeUrl}</code> : null}
          {authorizeUrl ? (
            <button type="button" className="mobile-debug-copy" onClick={() => void copyAuthorizeUrl()}>
              <Copy size={14} /> {copyStatus ?? "Copy URL"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatDebugTime(value: number): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MobileProviderProgress(props: { session: ProviderConnectionSession }) {
  const steps = [
    { key: "provider", label: "Provider" },
    { key: "configure", label: "Setup" },
    { key: "authorize", label: "Sign in" },
  ] as const;
  const activeIndex = props.session.stage === "complete"
    ? steps.length
    : Math.max(0, steps.findIndex((step) => step.key === props.session.stage));

  return (
    <div className="mobile-provider-progress" aria-label="Provider connection progress">
      {steps.map((step, index) => (
        <div
          key={step.key}
          className={`${index === activeIndex ? "active" : ""}${index < activeIndex ? " complete" : ""}`}
        >
          <span>{index < activeIndex ? <CheckCircle2 size={12} /> : null}</span>
          {step.label}
        </div>
      ))}
    </div>
  );
}

function SummaryTile(props: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={`mobile-summary-tile ${props.tone ?? ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function providerIssueMessage(remote: ProviderRemote): string | null {
  if (remote.needsReconnect) {
    return "Sign in again to refresh this provider.";
  }
  return remote.error || null;
}

function workflowForType(workflows: ProviderWorkflow[], type: string): ProviderWorkflow | null {
  return workflows.find((workflow) => workflow.type === type) ?? null;
}

function sheetTitle(session: ProviderConnectionSession): string {
  if (session.mode === "reconnect") return "Reconnect";
  if (session.mode === "repair") return "Configure";
  if (session.stage === "complete") return "Connected";
  return "Connect provider";
}

function sheetStepLabel(session: ProviderConnectionSession): string {
  if (session.stage === "provider") return "Choose";
  if (session.stage === "configure") return "Setup";
  if (session.stage === "authorize") return "Authorize";
  return "Done";
}

function submitLabel(session: ProviderConnectionSession): string {
  if (session.inFlight) return session.step ? "Continuing..." : "Starting...";
  if (session.step) return "Continue";
  if (session.mode === "reconnect") return "Reconnect";
  if (session.mode === "repair") return "Configure";
  return "Connect";
}
