import { BellOff, FolderOpen, HardDrive, LogOut, Pencil, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import type { Space } from "../../api/dto/entities";
import { switchSpaceWindow } from "@/features/app-windows";
import { DropdownMenuSeparator, MenuCheckItem, MenuItem, notify } from "@misty/ui";
import { driveNative } from "../../drive/driveNative";
import { setMuted, useMessageNotices } from "@/shared/lib/messageNotices";
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
 * checkmark on the one it shows; tabs stay as they are), a new Space, inviting people for its
 * owner, then the Space itself: its people, its shared folders, renaming, leaving or deleting it.
 */
export function SpaceMenuItems(props: {
  space: Space;
  /**
   * The sidebar's side: Personal lists only the person's own Space, Spaces only the shared ones.
   * Without it, every Space, the person's own first.
   */
  place?: "personal" | "spaces";
  onDialog: (dialog: SpaceDialog) => void;
  onCreate: () => void;
}) {
  const { space, onDialog } = props;
  const place = props.place;
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);
  const ordered =
    place === "personal"
      ? personal
        ? [personal]
        : []
      : place === "spaces"
        ? spaces.filter((item) => !item.is_default)
        : personal
          ? [personal, ...spaces.filter((item) => item !== personal)]
          : spaces;
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
            label={isPersonal && place ? "Personal" : spaceNavigationName(item)}
          />
        );
      })}
    </>
  );
  return (
    <>
      {spaceList}
      <MenuItem icon={<Plus />} label="New Space" onSelect={later(props.onCreate)} />
      {/* Only the owner can invite, so the menu offers it to no one else; Personal is private. */}
      {space.role === "owner" && !space.is_default && (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            icon={<UserPlus />}
            label="Invite people"
            onSelect={later(() => onDialog("invite"))}
          />
        </>
      )}
      <DropdownMenuSeparator />
      <SpaceSettingsItems space={space} onDialog={onDialog} />
    </>
  );
}

/**
 * What can be done to the Space itself: see its people and its shared folders, rename it, and
 * leave or delete it, each only for those allowed to.
 */
export function SpaceSettingsItems(props: {
  space: Space;
  onDialog: (dialog: SpaceDialog) => void;
}) {
  const { space, onDialog } = props;
  const isOwner = space.role === "owner";
  const muted = useMessageNotices((state) => state.value.muted.includes(space.id));
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  return (
    <>
      <MenuItem icon={<UsersRound />} label="People" onSelect={later(() => onDialog("members"))} />
      <MenuItem
        icon={<FolderOpen />}
        label="Shared folders"
        onSelect={later(() => onDialog("folders"))}
      />
      {/* The Space's drive on this computer, in the system's file manager. */}
      <MenuItem
        icon={<HardDrive />}
        label="Show drive"
        onSelect={() =>
          void driveNative
            .reveal(space.id)
            .catch(() => notify({ message: "The drive couldn't be shown. Try again.", tone: "error" }))
        }
      />
      <MenuCheckItem
        icon={<BellOff />}
        label="Mute notifications"
        checked={muted}
        onSelect={() => setMuted(space.id, !muted)}
      />
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
