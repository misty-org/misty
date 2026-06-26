import type { RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { Panel, PanelHeader } from "../../../shared/components/Panel";
import { RemoteConfigForm } from "./RemoteConfigForm";
import { RemoteEditActions } from "./RemoteEditActions";

const dirtyPillClass =
  "rounded-full border border-[color-mix(in_srgb,var(--misty-warning)_48%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-warning)_12%,var(--misty-surface))] px-[9px] py-[5px] text-xs text-[var(--misty-warning)]";

const stalePillClass =
  "rounded-full border border-[color-mix(in_srgb,var(--misty-danger)_44%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface))] px-[9px] py-[5px] text-xs text-[var(--misty-danger)]";

const staleWarningClass =
  "flex max-w-[760px] items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--misty-danger)_32%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-danger)_8%,var(--misty-surface))] px-[18px] py-2.5 text-[var(--misty-danger)]";

const staleWarningButtonClass =
  "shrink-0 rounded-[7px] border border-[color-mix(in_srgb,var(--misty-danger)_44%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-danger)_10%,var(--misty-surface))] px-2.5 py-1.5 text-[var(--misty-danger)] disabled:opacity-55";

const remoteEditPanelClass =
  "grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-auto";

interface RemoteEditPanelProps {
  draft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
  configKeys: string[];
  dirty: boolean;
  loadingRemoteName: string | null;
  working: boolean;
  tokenVisible: boolean;
  validRemoteName: boolean;
  stale: boolean;
  serviceError: string | null;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
  onTest: () => void;
  onReveal: () => void;
  onSave: () => void;
  onReload: () => void;
}

export function RemoteEditPanel(props: RemoteEditPanelProps) {
  const { draft } = props;
  const loading = Boolean(props.loadingRemoteName);

  return (
    <Panel className={remoteEditPanelClass}>
      <PanelHeader
        title="Edit Remote"
        subtitle={loading ? `Loading ${props.loadingRemoteName}` : draft ? `${draft.providerType} · ${draft.originalName}` : "Select a remote"}
        actions={<>
          {!loading && props.stale ? <span className={stalePillClass}>Stale</span> : null}
          {!loading && props.dirty ? <span className={dirtyPillClass}>Unsaved</span> : null}
        </>}
      />

      {loading ? (
        <RemoteEditSkeleton />
      ) : draft ? (
        <>
          {props.stale ? (
            <div className={staleWarningClass}>
              <span className="min-w-0 [overflow-wrap:anywhere]">This remote changed in another pane. Reload before saving.</span>
              <button className={staleWarningButtonClass} type="button" onClick={props.onReload} disabled={props.working}>Reload</button>
            </div>
          ) : null}
          <RemoteConfigForm
            draft={draft}
            configKeys={props.configKeys}
            configPaths={props.configPaths}
            tokenVisible={props.tokenVisible}
            onDraftName={props.onDraftName}
            onConfigField={props.onConfigField}
            onTokenField={props.onTokenField}
            onTokenVisible={props.onTokenVisible}
          />
          <RemoteEditActions
            working={props.working}
            dirty={props.dirty}
            validRemoteName={props.validRemoteName}
            stale={props.stale}
            onTest={props.onTest}
            onReveal={props.onReveal}
            onSave={props.onSave}
          />
        </>
      ) : (
        <div className="empty inline-flex max-w-[560px] items-center gap-[9px]">
          <AssetIcon className="shrink-0 text-[var(--misty-accent)]" src={iconAssets.cloud24} size={22} />
          <span>
            {props.serviceError
              ? "Start or reconnect the Misty remote service, then refresh Remotes."
              : "Select a remote to view and edit its rclone configuration."}
          </span>
        </div>
      )}
    </Panel>
  );
}

function RemoteEditSkeleton() {
  const skeletonBlockClass = "rounded-[7px] bg-[var(--misty-surface-2)] animate-pulse";
  return (
    <div className="grid max-w-[760px] gap-3.5 p-[18px]" aria-busy="true" aria-label="Loading remote configuration">
      <div className="inline-flex items-center gap-2 text-[13px] text-[var(--misty-text-muted)]">
        <AssetIcon className="animate-spin" src={iconAssets.sync16} size={17} />
        <span>Loading remote configuration</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <span className={`${skeletonBlockClass} h-[68px]`} />
        <span className={`${skeletonBlockClass} h-[68px]`} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <span className={`${skeletonBlockClass} h-[68px]`} />
        <span className={`${skeletonBlockClass} h-[68px]`} />
      </div>
      <div className={`${skeletonBlockClass} h-24`} />
      <div className="grid grid-cols-2 gap-4">
        <span className={`${skeletonBlockClass} h-[68px]`} />
        <span className={`${skeletonBlockClass} h-[68px]`} />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2.5">
        <span className={`${skeletonBlockClass} h-10`} />
        <span className={`${skeletonBlockClass} h-10`} />
        <span className={`${skeletonBlockClass} h-10`} />
      </div>
    </div>
  );
}
