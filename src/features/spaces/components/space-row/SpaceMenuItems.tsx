import { LogOut, Pencil, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
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
 * one it shows; tabs stay as they are), a new Space, and inviting people to this one.
 */
export function SpaceMenuItems(props: {
  space: Space;
  onDialog: (dialog: SpaceDialog) => void;
  onCreate: () => void;
}) {
  const { space, onDialog } = props;
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);
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
  return (
    <>
      {spaceList}
      <MenuItem
        icon={<Plus className="size-4" />}
        label="New Space"
        onSelect={later(props.onCreate)}
      />
      <DropdownMenuSeparator />
      <MenuItem
        icon={<UserPlus className="size-4" />}
        label="Invite people"
        onSelect={later(() => onDialog("invite"))}
      />
    </>
  );
}

/**
 * What can be done to the Space itself, from its Home: see its people, rename it, and leave or
 * delete it, each only for those allowed to.
 */
export function SpaceSettingsItems(props: {
  space: Space;
  onDialog: (dialog: SpaceDialog) => void;
}) {
  const { space, onDialog } = props;
  const isOwner = space.role === "owner";
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  return (
    <>
      <MenuItem
        icon={<UsersRound className="size-4" />}
        label="People"
        onSelect={later(() => onDialog("members"))}
      />
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
}
