import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";

interface RemoteEditActionsProps {
  working: boolean;
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  onTest: () => void;
  onReveal: () => void;
  onSave: () => void;
}

export function RemoteEditActions(props: RemoteEditActionsProps) {
  return (
    <footer className="edit-actions">
      <button onClick={props.onTest} disabled={props.working}>
        <AssetIcon src={iconAssets.cloud24} size={16} />
        Test Connection
      </button>
      <button onClick={props.onReveal} disabled={props.working}>
        <AssetIcon src={iconAssets.fileDirectoryOpenFill24} size={16} />
        Reveal Config
      </button>
      <button className="primary" onClick={props.onSave} disabled={props.working || props.stale || !props.dirty || !props.validRemoteName}>
        <AssetIcon src={iconAssets.activityCheck} size={16} />
        Save Changes
      </button>
    </footer>
  );
}
