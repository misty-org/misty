import { Puzzle } from "lucide-react";
import { cn, IconButton, toolbarIconProps } from "@/shared/ui";
import type { ExtensionAction, Installation } from "./types";

/** One pinned extension in the browser toolbar: its own icon, running its action on click. */
export function PinnedExtensionButton({
  item,
  action,
  icon,
  usable,
  onInvoke,
}: {
  item: Installation;
  action: ExtensionAction | undefined;
  icon: string | undefined;
  usable: boolean;
  onInvoke: (id: string, anchor: HTMLElement) => void;
}) {
  return (
    <IconButton
      label={item.name}
      tooltip={false}
      title={action?.title || item.name}
      disabled={!item.enabled || !usable}
      onClick={(event) => onInvoke(item.id, event.currentTarget)}
    >
      {icon ? (
        <img src={icon} alt="" className={cn("size-5", !item.enabled && "grayscale")} />
      ) : (
        <Puzzle {...toolbarIconProps} />
      )}
    </IconButton>
  );
}
