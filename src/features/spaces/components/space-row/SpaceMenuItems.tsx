import { LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import type { Space } from "../../api/dto/entities";
import { switchSpaceWindow } from "@/features/app-windows";
import { DropdownMenuCheckboxItem, DropdownMenuSeparator, MenuItem } from "@/shared/ui";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../routes/defaultSpace";
import { useSpacesStore } from "../../list/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";
import type { SpaceDialog } from "./SpaceDialogs";

/**
 * The Space menu: your Spaces (choosing one shows it in this window, with a checkmark on the
 * one it shows; tabs stay as they are), a new Space, then renaming, leaving or deleting this one.
 */
export function SpaceMenuItems(props: {
  space: Space;
  onDialog: (dialog: SpaceDialog) => void;
  onCreate: () => void;
}) {
  const { space, onDialog } = props;
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);
  const isOwner = space.role === "owner";
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  const spaceList = (
    <>
      {spaces.map((item) => {
        const isPersonal = item.id === personal?.id;
        const here = item.id === space.id;
        return (
          <DropdownMenuCheckboxItem
            key={item.id}
            checked={here}
            onSelect={() => {
              if (!here) switchSpaceWindow(item.id, isPersonal);
            }}
          >
            <SpaceAvatar
              space={item}
              className="size-5 rounded-md"
              fallbackClassName="text-3xs font-semibold"
            />
            <span className="min-w-0 flex-1 truncate">{spaceNavigationName(item)}</span>
          </DropdownMenuCheckboxItem>
        );
      })}
    </>
  );
  const windowItems = (
    <MenuItem
      icon={<Plus className="size-4" />}
      label="New Space"
      onSelect={later(props.onCreate)}
    />
  );
  const settings = (
    <>
      {isOwner && canManageSpaceLifecycle(space, "rename") && (
        <MenuItem
          icon={<Pencil className="size-4" />}
          label="Rename"
          onSelect={later(() => onDialog("rename"))}
        />
      )}
      {isOwner && canManageSpaceLifecycle(space, "delete") ? (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<Trash2 className="size-4" />}
            label="Delete Space"
            onSelect={later(() => onDialog("delete"))}
          />
        </>
      ) : !isOwner && canManageSpaceLifecycle(space, "leave") ? (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<LogOut className="size-4" />}
            label="Leave Space"
            onSelect={later(() => onDialog("leave"))}
          />
        </>
      ) : null}
    </>
  );
  return (
    <>
      {spaceList}
      <DropdownMenuSeparator />
      {windowItems}
      <DropdownMenuSeparator />
      {settings}
    </>
  );
}
