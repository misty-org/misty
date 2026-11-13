import { LogOut, Pencil, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import type { Space } from "../../api/dto/entities";
import { switchSpaceWindow } from "@/features/app-windows";
import { DropdownMenuSeparator, MenuCheckItem, MenuItem } from "@/shared/ui";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../routes/defaultSpace";
import { useSpacesStore } from "../../list/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";
import type { SpaceDialog } from "./SpaceDialogs";

/**
 * The Space menu: your Spaces, your own first (choosing one shows it in this window, with a
 * checkmark on the one it shows; tabs stay as they are), a new Space, and, for its owner, inviting people to it.
 */
export function SpaceMenuItems(props: {
  space: Space;
  onDialog: (dialog: SpaceDialog) => void;
  onCreate: () => void;
}) {
  const { space, onDialog } = props;
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);
  const ordered = personal ? [personal, ...spaces.filter((item) => item !== personal)] : spaces;
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  const spaceList = (
    <>
      {ordered.map((item) => {
        const isPersonal = item.id === personal?.id;
        const here = item.id === space.id;
        return (
          <MenuCheckItem
            key={item.id}
            checked={here}
            closeOnSelect
            onSelect={() => {
              if (!here) switchSpaceWindow(item.id, isPersonal);
            }}
            icon={
              <SpaceAvatar
                space={item}
                className="size-5 rounded-md"
                fallbackClassName="text-3xs font-semibold"
              />
            }
            label={spaceNavigationName(item)}
          />
        );
      })}
    </>
  );
  return (
    <>
      {spaceList}
      <MenuItem icon={<Plus />} label="New Space" onSelect={later(props.onCreate)} />
      {/* Only the owner can invite, so the menu offers it to no one else. */}
      {space.role === "owner" && (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<UserPlus />}
            label="Invite people"
            onSelect={later(() => onDialog("invite"))}
          />
        </>
      )}
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
      <MenuItem icon={<UsersRound />} label="People" onSelect={later(() => onDialog("members"))} />
      {isOwner && canManageSpaceLifecycle(space, "rename") && (
        <MenuItem
          icon={<Pencil />}
          label="Edit name and picture"
          onSelect={later(() => onDialog("rename"))}
        />
      )}
      {isOwner && canManageSpaceLifecycle(space, "delete") ? (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            label="Delete Space"
            onSelect={later(() => onDialog("delete"))}
          />
        </>
      ) : !isOwner && canManageSpaceLifecycle(space, "leave") ? (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<LogOut />}
            label="Leave Space"
            onSelect={later(() => onDialog("leave"))}
          />
        </>
      ) : null}
    </>
  );
}
