import { iconAssets } from "@/shared/assets/icons";
import { AssetIcon, Button } from "@/shared/ui";

const editActionsClass =
  "grid max-w-[760px] grid-cols-3 gap-2.5 px-[18px] pb-[18px] max-[980px]:grid-cols-1";

export function RemoteEditActions(props: RemoteEditActionsProps) {
  return (
    <footer className={editActionsClass}>
      <Button
        onClick={props.onSave}
        disabled={props.working || props.stale || !props.dirty || !props.validRemoteName}
      >
        <AssetIcon src={iconAssets.activityCheck} size={16} />
        Save Changes
      </Button>
      <Button
        variant="outline"
        onClick={props.onTest}
        disabled={props.working || props.dirty || !props.validRemoteName}
        title={
          props.dirty
            ? "Save your changes before testing this remote."
            : "Check that this remote responds."
        }
      >
        <AssetIcon src={iconAssets.sync16} size={16} />
        Test Connection
      </Button>
      <Button variant="destructive" onClick={props.onDelete} disabled={props.working}>
        <AssetIcon src={iconAssets.trash24} size={16} />
        Delete
      </Button>
    </footer>
  );
}

export interface RemoteEditActionsProps {
  working: boolean;
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  onSave: () => void;
  onDelete: () => void;
  onTest: () => void;
}
