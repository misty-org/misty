import type { RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { Panel, PanelHeader } from "../../../shared/components/Panel";
import { RemoteConfigForm } from "./RemoteConfigForm";
import { RemoteEditActions } from "./RemoteEditActions";

interface RemoteEditPanelProps {
  draft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
  configKeys: string[];
  dirty: boolean;
  working: boolean;
  tokenVisible: boolean;
  validRemoteName: boolean;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
  onTest: () => void;
  onReveal: () => void;
  onSave: () => void;
}

export function RemoteEditPanel(props: RemoteEditPanelProps) {
  const { draft } = props;

  return (
    <Panel className="edit-panel">
      <PanelHeader
        title="Edit Remote"
        subtitle={draft ? `${draft.providerType} · ${draft.originalName}` : "Select a remote"}
        actions={props.dirty ? <span className="dirty-pill">Unsaved</span> : null}
      />

      {draft ? (
        <>
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
            onTest={props.onTest}
            onReveal={props.onReveal}
            onSave={props.onSave}
          />
        </>
      ) : (
        <div className="empty">Provider commands are wired; select a remote to load its rclone config.</div>
      )}
    </Panel>
  );
}
