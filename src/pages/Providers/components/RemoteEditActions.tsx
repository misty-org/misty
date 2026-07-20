import type { RemoteEditActionsProps } from "@/models/interfaces/pages/Providers/components/RemoteEditActions";
export type { RemoteEditActionsProps } from "@/models/interfaces/pages/Providers/components/RemoteEditActions";
import { Button } from "@/ui";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";

const editActionsClass =
  "grid max-w-[760px] grid-cols-2 gap-2.5 px-[18px] pb-[18px] max-[980px]:grid-cols-1";

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
      <Button variant="destructive" onClick={props.onDelete} disabled={props.working}>
        <AssetIcon src={iconAssets.trash24} size={16} />
        Delete
      </Button>
    </footer>
  );
}
