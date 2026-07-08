import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";

interface RemoteEditActionsProps {
  working: boolean;
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  onSave: () => void;
  onDelete: () => void;
}

const editActionsClass =
  "grid max-w-[760px] grid-cols-2 gap-2.5 px-[18px] pb-[18px] max-[980px]:grid-cols-1";

const editButtonClass =
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-[10px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-3 py-2.5 text-[var(--misty-text)] disabled:opacity-55";

const primaryEditButtonClass =
  `${editButtonClass} border-[var(--misty-primary)] bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)]`;

const dangerEditButtonClass =
  `${editButtonClass} border-[color-mix(in_srgb,var(--misty-danger)_44%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface))] text-[var(--misty-danger)]`;

export function RemoteEditActions(props: RemoteEditActionsProps) {
  return (
    <footer className={editActionsClass}>
      <button className={primaryEditButtonClass} onClick={props.onSave} disabled={props.working || props.stale || !props.dirty || !props.validRemoteName}>
        <AssetIcon src={iconAssets.activityCheck} size={16} />
        Save Changes
      </button>
      <button className={dangerEditButtonClass} onClick={props.onDelete} disabled={props.working}>
        <AssetIcon src={iconAssets.trash24} size={16} />
        Delete
      </button>
    </footer>
  );
}
