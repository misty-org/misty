import {
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
import {
  mobileEmptyIconClass,
  mobileEmptyStateClass,
  mobileErrorClass,
  mobileFootnoteClass,
  mobilePageClass,
  mobileSectionEyebrowClass,
  mobileSectionHeaderClass,
  mobileSectionTitleClass,
  mobileSuccessClass,
} from "../../../shell/mobileStyles";
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
} from "../../../stores/useProvidersStore";

const EMPTY_REMOTES: ProviderRemote[] = [];
const EMPTY_WORKFLOWS: ProviderWorkflow[] = [];
const mobileProviderWorkspaceId = "mobile-providers";
const sheetBackdropClass = "fixed inset-0 z-[1000] flex items-end bg-black/50";
const sheetClass = "w-full max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),680px)] overflow-auto rounded-t-3xl border border-white/10 bg-[#0a0f15] px-[max(var(--misty-mobile-edge),var(--misty-safe-left))] pb-[calc(18px+var(--misty-safe-bottom))] pr-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pt-[18px] shadow-[0_-20px_55px_rgba(0,0,0,0.5)]";
const sheetHeaderClass = "mb-3.5 flex items-center justify-between gap-3";
const sheetKickerClass = "text-[11px] font-bold uppercase tracking-normal text-[#8792a0]";
const sheetTitleClass = "m-0 text-xl font-black leading-[1.15] text-[#f4f0e8]";
const actionStackClass = "mt-3 grid gap-2.5";
const primaryActionClass = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border-0 bg-[#eef3fb] px-4 font-bold text-[#05070a] disabled:opacity-50";
const secondaryActionClass = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-white/10 bg-[#101720] px-4 font-bold text-[#eef3fb] disabled:opacity-50";
const dangerActionClass = `${secondaryActionClass} text-[#ffb8bf]`;
const inputGroupClass = "grid min-w-0 gap-1.5";
const inputLabelClass = "text-xs font-bold text-[#a3adba]";
const inputControlClass = "h-[46px] w-full min-w-0 rounded-[14px] border border-white/10 bg-[#0b1118] px-[13px] text-base text-[#f4f0e8] outline-none focus:border-[#86b7ff6b] focus:shadow-[0_0_0_3px_rgba(134,183,255,0.12)] disabled:opacity-50 read-only:text-[#a3adba]";
const iconButtonClass = "relative grid h-[38px] w-[38px] flex-none place-items-center rounded-xl border border-white/10 bg-[#101720] text-[#eef3fb] disabled:opacity-45";
const compactEmptyClass = "grid place-items-center gap-2.5 text-center";
const noteClass = "m-0 text-[13px] leading-[1.4] text-[#a3adba]";

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
    if (remote.configSource === "user") {
      void openRepairRemote(remote);
      return;
    }
    setManagedRemoteName(remote.name);
    void selectRemoteInWorkspace(mobileProviderWorkspaceId, remote.name);
  };

  return (
    <section className={mobilePageClass}>
      <div className="mb-3.5 grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
        <div className="grid h-[52px] w-[52px] place-items-center rounded-2xl bg-[#86b7ff24] text-[#cfe2ff]">
          <Cloud size={31} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-normal text-[#8792a0]">Cloud access</span>
          <h2 className="m-0 mb-1 truncate text-2xl font-black leading-[1.1] text-[#f4f0e8]">
            {connectedCount > 0 ? `${connectedCount} connected` : "Connect remotes"}
          </h2>
          <p className="m-0 text-[13px] leading-[1.35] text-[#a3adba]">{status}</p>
        </div>
      </div>

      {error ? <div className={mobileErrorClass}>{error}</div> : null}
      {message ? <div className={mobileSuccessClass}>{message}</div> : null}

      <div className="mb-4 grid grid-cols-2 gap-3.5">
        <SummaryTile label="Service" value={health?.ready ? "Ready" : "Unavailable"} tone={health?.ready ? "good" : "warn"} />
        <SummaryTile label="Connected" value={`${connectedCount}`} tone={connectedCount > 0 ? "good" : undefined} />
        <SummaryTile label="Available" value={`${providerCount}`} />
        <SummaryTile label="Version" value={health?.version || "Unknown"} />
      </div>

      <div className={actionStackClass}>
        <button
          type="button"
          className={primaryActionClass}
          disabled={working}
          onClick={() => void openAddRemote()}
        >
          <FolderPlus size={18} /> Connect provider
        </button>
        <button
          type="button"
          className={secondaryActionClass}
          disabled={loading || working}
          onClick={() => void load(true)}
        >
          <RefreshCcw className={loading ? "animate-spin" : undefined} size={17} /> Refresh
        </button>
      </div>

      <section className="mt-[18px]">
        <div className={mobileSectionHeaderClass}>
          <div>
            <span className={mobileSectionEyebrowClass}>Remotes</span>
            <h2 className={mobileSectionTitleClass}>Your remotes</h2>
          </div>
        </div>

        {loading && remotes.length === 0 ? (
          <div className="grid gap-0">
            <div className="relative min-h-[118px] overflow-hidden border-0 border-b border-[var(--misty-border-soft)] py-3 after:absolute after:inset-[14px] after:rounded-xl after:bg-[linear-gradient(90deg,var(--misty-surface-2),var(--misty-surface-3),var(--misty-surface-2))] after:opacity-75" />
            <div className="relative min-h-[118px] overflow-hidden border-0 border-b border-[var(--misty-border-soft)] py-3 after:absolute after:inset-[14px] after:rounded-xl after:bg-[linear-gradient(90deg,var(--misty-surface-2),var(--misty-surface-3),var(--misty-surface-2))] after:opacity-75" />
          </div>
        ) : remotes.length > 0 ? (
          <div className="grid gap-0">
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
          <div className={mobileEmptyStateClass}>
            <div className={mobileEmptyIconClass}>
              <PlugZap size={31} strokeWidth={1.7} />
            </div>
            <h3>No remotes yet</h3>
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
  const externalConfig = props.remote.configSource === "user";
  const healthy = !props.remote.needsReconnect && !props.remote.error;
  const issueMessage = providerIssueMessage(props.remote);
  return (
    <article className={`grid min-w-0 gap-2.5 border-0 border-b border-[var(--misty-border-soft)] bg-transparent py-3 text-[#eef3fb] ${healthy ? "" : "border-[#e9c77538]"}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[13px] bg-[#86b7ff24] text-[#cfe2ff]">
          <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
        </span>
        <div className="min-w-0">
          <strong className="block truncate text-[15px] font-bold text-[#f4f0e8]">{props.remote.name}</strong>
          <small className="block text-xs leading-[1.35] text-[#8792a0]">{props.remote.type}{externalConfig ? " · user config" : ""}</small>
        </div>
      </div>
      <div className={`text-xs font-bold ${healthy ? "text-[#9ee6b2]" : "text-[#e9c775]"}`}>
        <span>{props.remote.statusLabel}</span>
      </div>
      {issueMessage ? <p className="m-0 text-[13px] leading-[1.35] text-[#a3adba]">{issueMessage}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {externalConfig ? (
          <button type="button" className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.disabled} onClick={props.onRepair}>
            <FolderPlus size={15} /> Import
          </button>
        ) : (
          <button type="button" className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.disabled} onClick={props.onManage}>
            <Wrench size={15} /> Manage
          </button>
        )}
        {!externalConfig && props.remote.needsReconnect ? (
          <button type="button" className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.disabled} onClick={props.onReconnect}>
            <RefreshCcw size={15} /> Reconnect
          </button>
        ) : null}
        {!externalConfig ? (
          <button type="button" className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.disabled} onClick={props.onRepair}>
            <Wrench size={15} /> Configure
          </button>
        ) : null}
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
    <div className={sheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${sheetClass} grid gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label={draft ? `Manage ${draft.name}` : "Manage remote"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={sheetHeaderClass}>
          <div>
            <span className={sheetKickerClass}>{loading ? "Loading" : "Remote"}</span>
            <h2 className={sheetTitleClass}>{loading ? props.workspace.loadingRemoteName : draft?.name ?? remote?.name ?? "Remote"}</h2>
          </div>
          <button type="button" className={iconButtonClass} aria-label="Close" disabled={props.working} onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>

        {loading ? (
          <div className="relative min-h-[118px] overflow-hidden border-0 border-b border-[var(--misty-border-soft)] py-3 after:absolute after:inset-[14px] after:rounded-xl after:bg-[linear-gradient(90deg,var(--misty-surface-2),var(--misty-surface-3),var(--misty-surface-2))] after:opacity-75" />
        ) : draft ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {props.stale ? <span className="inline-flex min-h-[26px] items-center rounded-full border border-[#e9c7753d] bg-[#e9c7751a] px-2.5 text-[11px] font-bold text-[#e9c775]">Stale</span> : null}
              {props.dirty ? <span className="inline-flex min-h-[26px] items-center rounded-full border border-[#86b7ff2e] bg-[#86b7ff1a] px-2.5 text-[11px] font-bold text-[#cfe2ff]">Unsaved</span> : null}
              {!props.dirty && !props.stale ? <span className="inline-flex min-h-[26px] items-center rounded-full border border-[#9ee6b233] bg-[#9ee6b217] px-2.5 text-[11px] font-bold text-[#9ee6b2]">Saved</span> : null}
            </div>

            {props.stale ? (
              <div className={mobileErrorClass}>
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

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.working} onClick={props.onTest}>
                <Cloud size={16} /> Test
              </button>
              <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.working} onClick={props.onReveal}>
                <FileText size={16} /> Config
              </button>
              <button
                type="button"
                className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50"
                disabled={props.working || props.stale || !props.dirty || !props.validRemoteName}
                onClick={props.onSave}
              >
                <Save size={16} /> Save
              </button>
              <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.working} onClick={props.onReload}>
                <RefreshCcw size={16} /> Reload
              </button>
              {remote ? (
                <>
                  <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.working} onClick={() => props.onRepair(remote)}>
                    <Wrench size={16} /> Repair
                  </button>
                  <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb] disabled:opacity-50" disabled={props.working} onClick={() => props.onReconnect(remote)}>
                    <RefreshCcw size={16} /> Reconnect
                  </button>
                </>
              ) : null}
              <button type="button" className="inline-flex min-h-[42px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-[#ffb8bf38] bg-[#ffb8bf14] px-2.5 text-xs font-bold text-[#ffb8bf] disabled:opacity-50" disabled={props.working} onClick={() => props.onDisconnect(draft.originalName)}>
                <Unplug size={16} /> Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className={`${mobileEmptyStateClass} place-items-center`}>
            <div className={mobileEmptyIconClass}>
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
    <div className="grid gap-2.5">
      <label className={inputGroupClass}>
        <span className={inputLabelClass}>Name</span>
        <input className={inputControlClass} value={props.draft.name} onChange={(event) => props.onDraftName(event.target.value)} />
      </label>
      <label className={inputGroupClass}>
        <span className={inputLabelClass}>Type</span>
        <input className={inputControlClass} value={props.draft.providerType || props.draft.config.type || ""} readOnly />
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
        <div className="grid gap-[7px] rounded-[14px] border border-white/10 bg-[#05080c] p-[11px]">
          <div className="grid min-w-0 gap-[3px]"><span className="text-[11px] font-bold uppercase text-[#8792a0]">Config</span><strong className="min-w-0 break-words text-xs font-semibold text-[#dbe5f0]">{props.configPaths.configPath ?? "--"}</strong></div>
          <div className="grid min-w-0 gap-[3px]"><span className="text-[11px] font-bold uppercase text-[#8792a0]">Cache</span><strong className="min-w-0 break-words text-xs font-semibold text-[#dbe5f0]">{props.configPaths.cachePath ?? "--"}</strong></div>
          <div className="grid min-w-0 gap-[3px]"><span className="text-[11px] font-bold uppercase text-[#8792a0]">Temp</span><strong className="min-w-0 break-words text-xs font-semibold text-[#dbe5f0]">{props.configPaths.tempPath ?? "--"}</strong></div>
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
        <fieldset className="m-0 grid min-w-0 gap-2.5 rounded-2xl border border-white/10 bg-[#0b1016] p-3">
          <legend className="flex w-full items-center justify-between gap-2.5 p-0 text-[11px] font-extrabold uppercase tracking-normal text-[#8792a0]">
            <span>Authentication</span>
            <button type="button" className="inline-flex min-h-[30px] items-center gap-1.5 rounded-full border border-white/10 bg-[#101720] px-2.5 text-xs font-bold normal-case text-[#eef3fb]" onClick={() => props.onTokenVisible(!props.tokenVisible)}>
              {props.tokenVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              {props.tokenVisible ? "Hide" : "Show"}
            </button>
          </legend>
          {fields.map((field) => (
            <label key={field.key} className={inputGroupClass}>
              <span className={inputLabelClass}>{prettyLabel(field.key)}</span>
              <input
                className={inputControlClass}
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
    <label className={inputGroupClass}>
      <span className={inputLabelClass}>{prettyLabel(props.configKey)}</span>
      <input
        className={inputControlClass}
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
    <div className={sheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${sheetClass} grid gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label={`Disconnect ${props.remoteName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={sheetHeaderClass}>
          <div>
            <span className={sheetKickerClass}>Disconnect</span>
            <h2 className={sheetTitleClass}>{props.remoteName}</h2>
          </div>
          <button type="button" className={iconButtonClass} aria-label="Close" disabled={props.working} onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>
        <p className={noteClass}>
          This removes the remote from Misty. Files already on the provider are not deleted.
        </p>
        <div className={actionStackClass}>
          <button type="button" className={dangerActionClass} disabled={props.working} onClick={props.onConfirm}>
            <Trash2 size={17} /> {props.working ? "Disconnecting..." : "Disconnect"}
          </button>
          <button type="button" className={secondaryActionClass} disabled={props.working} onClick={props.onClose}>
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
    <div className={sheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${sheetClass} max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),760px)]`}
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle(props.session)}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={sheetHeaderClass}>
          <div>
            <span className={sheetKickerClass}>{sheetStepLabel(props.session)}</span>
            <h2 className={sheetTitleClass}>{sheetTitle(props.session)}</h2>
          </div>
          <button
            type="button"
            className={iconButtonClass}
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
          <div className={compactEmptyClass}>
            <div className={`${mobileEmptyIconClass} border-[#86efac57] bg-[#86efac1c] text-[#86efac]`}>
              <ShieldCheck size={31} strokeWidth={1.7} />
            </div>
            <h3>Provider connected</h3>
            <p className={noteClass}>{props.session.remoteName} is ready in Files.</p>
          </div>
        ) : null}

        {props.session.error ? <div className={mobileErrorClass}>{props.session.error}</div> : null}

        <div className={actionStackClass}>
          {props.session.stage === "configure" ? (
            <button
              type="button"
              className={primaryActionClass}
              disabled={props.session.inFlight}
              onClick={() => props.onSubmit(false)}
            >
              <ShieldCheck className={props.session.inFlight ? "animate-spin" : undefined} size={18} />
              {submitLabel(props.session)}
            </button>
          ) : null}
          {props.session.stage === "authorize" ? (
            <button
              type="button"
              className={primaryActionClass}
              disabled={props.session.inFlight}
              onClick={() => props.onSubmit(true)}
            >
              <RefreshCcw className={props.session.inFlight ? "animate-spin" : undefined} size={18} />
              {props.session.inFlight ? "Checking..." : "Check authorization"}
            </button>
          ) : null}
          {props.session.stage === "complete" ? (
            <button type="button" className={primaryActionClass} onClick={props.onClose}>
              Done
            </button>
          ) : null}
          {props.session.stage !== "complete" ? (
            <button
              type="button"
              className={secondaryActionClass}
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
      <div className={`${mobileEmptyStateClass} place-items-center`}>
        <div className={mobileEmptyIconClass}>
          <Cloud size={28} strokeWidth={1.7} />
        </div>
        <h3>No provider workflows</h3>
        <p>Refresh Remotes and make sure the Misty remote service is running.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      {props.workflows.map((workflow) => {
        const providerIcon = providerIconForType(workflow.type);
        return (
          <button
            key={workflow.type}
            type="button"
            className="flex min-w-0 w-full items-center gap-[11px] rounded-2xl border border-white/10 bg-[#0b1016] p-3.5 text-left text-[#eef3fb] hover:bg-[#101720] focus-visible:bg-[#101720]"
            onClick={() => props.onChooseProvider(workflow.type)}
          >
            <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[13px] bg-[#86b7ff24] text-[#cfe2ff]">
              <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-[15px] font-bold text-[#f4f0e8]">{workflow.name || workflow.type}</strong>
              <small className="block text-xs leading-[1.35] text-[#8792a0]">{workflow.description || workflow.type}</small>
            </span>
            <ChevronRight className="ml-auto flex-none text-[#8792a0]" size={18} strokeWidth={1.8} />
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
    <div className="grid gap-2.5">
      {props.onBack ? (
        <button type="button" className="inline-flex min-h-[34px] w-fit items-center gap-1.5 rounded-[11px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb]" onClick={props.onBack}>
          <ArrowLeft size={16} /> Remotes
        </button>
      ) : null}
      <label className={inputGroupClass}>
        <span className={inputLabelClass}>Remote name</span>
        <input
          className={inputControlClass}
          value={props.session.remoteName}
          readOnly={props.session.mode !== "add"}
          onChange={(event) => props.onName(event.target.value)}
        />
      </label>
      <div className="grid gap-1 rounded-[14px] border border-white/10 bg-[#0b1016] p-3">
        <span className={sheetKickerClass}>Provider</span>
        <strong className="truncate text-[15px] font-bold text-[#f4f0e8]">{props.workflow?.name || props.session.providerType}</strong>
      </div>
      {options.map((option) => (
        <ProviderOptionField
          key={option.name}
          option={option}
          value={props.session.parameters[option.name] ?? ""}
          onChange={(value) => props.onParameter(option.name, value)}
        />
      ))}
      {props.session.step?.instructions ? <p className={mobileFootnoteClass}>{props.session.step.instructions}</p> : null}
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
    <label className={inputGroupClass}>
      <span className={inputLabelClass}>{option.label || option.name}{option.required ? " *" : ""}</span>
      {option.choices.length > 0 ? (
        <select className={inputControlClass} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.help || choice.value}</option>
          ))}
        </select>
      ) : (
        <input
          className={inputControlClass}
          value={props.value}
          type={option.password ? "password" : "text"}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {option.help ? <small className="text-xs leading-[1.35] text-[#8792a0]">{option.help}</small> : null}
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
    <div className={compactEmptyClass}>
      <div className={mobileEmptyIconClass}>
        <ExternalLink size={30} strokeWidth={1.7} />
      </div>
      <h3>Finish provider sign in</h3>
      <p className={noteClass}>{props.session.step?.instructions || "Misty opened the provider sign-in page and is waiting for authorization."}</p>
      <small className="block text-xs leading-[1.35] text-[#8792a0]">
        {props.session.polling
          ? `Checking authorization${props.session.authPollAttempts > 0 ? ` (${props.session.authPollAttempts})` : ""}...`
          : "Return here after sign in finishes."}
      </small>
      {props.session.step?.authorizeUrl ? (
        <button type="button" className={`${secondaryActionClass} mt-1`} onClick={props.onOpenAuthorize}>
          <ExternalLink size={16} /> {props.session.openedAuthorizeUrl ? "Reopen sign in" : "Open sign in"}
        </button>
      ) : null}
      <div className="mt-1.5 w-full min-w-0 text-left">
        <div className="grid gap-[5px] rounded-xl border border-white/10 border-l-[#86b7ff] bg-[#080d13] p-2.5">
          <strong className="text-xs text-[#f4f0e8]">Provider auth debug</strong>
          <p className="m-0 text-[11px] leading-[1.35] text-[#a3adba]">Attempts: {props.session.authorizeOpenAttempts}</p>
          <p className="m-0 text-[11px] leading-[1.35] text-[#a3adba]">URL: {authorizeUrl ? "present" : "missing"}</p>
          {props.session.authorizeOpenResult ? (
            <>
              <p className="m-0 text-[11px] leading-[1.35] text-[#a3adba]">Platform: {props.session.authorizeOpenResult.platform}</p>
              <p className="m-0 text-[11px] leading-[1.35] text-[#a3adba]">Opened with: {props.session.authorizeOpenResult.strategy}</p>
              <time className="m-0 text-[11px] leading-[1.35] text-[#a3adba]">{formatDebugTime(props.session.authorizeOpenResult.attemptedAt)}</time>
              {props.session.authorizeOpenResult.fallbackReason ? (
                <code className="max-h-[108px] overflow-auto break-words rounded-lg bg-[#030609] p-2 text-[10px] leading-[1.4] text-[#d7e1ec] [white-space:pre-wrap]">{props.session.authorizeOpenResult.fallbackReason}</code>
              ) : null}
            </>
          ) : null}
          {props.session.authorizeOpenError ? <code className="max-h-[108px] overflow-auto break-words rounded-lg bg-[#030609] p-2 text-[10px] leading-[1.4] text-[#d7e1ec] [white-space:pre-wrap]">{props.session.authorizeOpenError}</code> : null}
          {authorizeUrl ? <code className="max-h-[108px] overflow-auto break-words rounded-lg bg-[#030609] p-2 text-[10px] leading-[1.4] text-[#d7e1ec] [white-space:pre-wrap]">{authorizeUrl}</code> : null}
          {authorizeUrl ? (
            <button type="button" className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-[10px] border border-white/10 bg-[#101720] px-2.5 text-xs font-bold text-[#eef3fb]" onClick={() => void copyAuthorizeUrl()}>
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
    <div className="mb-3.5 grid grid-cols-3 gap-1.5" aria-label="Provider connection progress">
      {steps.map((step, index) => (
        <div
          key={step.key}
          className={`flex min-h-[30px] min-w-0 items-center justify-center gap-1 rounded-[10px] text-[11px] font-bold ${index === activeIndex || index < activeIndex ? "bg-[#86b7ff29] text-[#f4f0e8]" : "bg-[#101720] text-[#8792a0]"}`}
        >
          <span className="grid h-3.5 w-3.5 place-items-center">{index < activeIndex ? <CheckCircle2 size={12} /> : null}</span>
          {step.label}
        </div>
      ))}
    </div>
  );
}

function SummaryTile(props: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="grid min-w-0 gap-[3px] border-0 bg-transparent p-0">
      <span className="truncate text-[11px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]">{props.label}</span>
      <strong className={`truncate text-2xl font-bold leading-none ${props.tone === "good" ? "text-[#86efac]" : props.tone === "warn" ? "text-[#fde68a]" : "text-[var(--misty-text)]"}`}>
        {props.value}
      </strong>
    </div>
  );
}

function providerIssueMessage(remote: ProviderRemote): string | null {
  if (remote.configSource === "user") {
    return "This remote is in your user rclone config. Import it into Misty before browsing it here.";
  }
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

export default MobileProvidersPage;
