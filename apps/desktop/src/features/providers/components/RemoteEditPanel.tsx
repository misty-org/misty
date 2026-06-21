import type { RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { Panel, PanelHeader } from "../../../shared/components/Panel";
import { RemoteConfigForm } from "./RemoteConfigForm";
import { RemoteEditActions } from "./RemoteEditActions";

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
    <Panel className="edit-panel">
      <PanelHeader
        title="Edit Remote"
        subtitle={loading ? `Loading ${props.loadingRemoteName}` : draft ? `${draft.providerType} · ${draft.originalName}` : "Select a remote"}
        actions={<>
          {!loading && props.stale ? <span className="stale-pill">Stale</span> : null}
          {!loading && props.dirty ? <span className="dirty-pill">Unsaved</span> : null}
        </>}
      />

      {loading ? (
        <RemoteEditSkeleton />
      ) : draft ? (
        <>
          {props.stale ? (
            <div className="stale-provider-warning">
              <span>This remote changed in another pane. Reload before saving.</span>
              <button type="button" onClick={props.onReload} disabled={props.working}>Reload</button>
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
        <div className="empty provider-empty">
          <AssetIcon src={iconAssets.cloud24} size={22} />
          <span>Provider commands are wired; select a remote to load its rclone config.</span>
        </div>
      )}
    </Panel>
  );
}

function RemoteEditSkeleton() {
  return (
    <div className="remote-edit-skeleton" aria-busy="true" aria-label="Loading remote configuration">
      <div className="remote-edit-skeleton-heading">
        <AssetIcon src={iconAssets.sync16} size={17} />
        <span>Loading remote configuration</span>
      </div>
      <div className="skeleton-row">
        <span />
        <span />
      </div>
      <div className="skeleton-row">
        <span />
        <span />
      </div>
      <div className="skeleton-wide" />
      <div className="skeleton-row">
        <span />
        <span />
      </div>
      <div className="skeleton-actions">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
