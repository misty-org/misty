import {
  BellOff,
  FolderOpen,
  HardDrive,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  Webhook,
} from "lucide-react";
import type { Space } from "../../api/dto/entities";
import { switchSpaceWindow } from "@/features/app-windows";
import { DropdownMenuSeparator, MenuCheckItem, MenuItem, notify } from "@misty/ui";
import { driveNative } from "../../drive/drive_native";
import { setMuted, useMessageNotices } from "@/shared/lib/message_notices";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../routes/default_space";
import { useSpacesStore } from "../../list/use_spaces_store";
import { SpaceAvatar } from "../SpaceAvatar";
import { spaceCan } from "../../roles/use_space_roles";
import type { SpaceDialog } from "./SpaceDialogs";

export function SpaceMenuItems(props: {
  space: Space;
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
                fallbackClassName="text-micro font-semibold"
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
      <DropdownMenuSeparator />
      <SpaceSettingsItems space={space} onDialog={onDialog} />
    </>
  );
}

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
      {!space.is_default && spaceCan(space, "space.invite") && (
        <MenuItem
          icon={<UserPlus />}
          label="Invite people"
          onSelect={later(() => onDialog("invite"))}
        />
      )}
      <MenuItem icon={<UsersRound />} label="People" onSelect={later(() => onDialog("members"))} />
      {!space.is_default && spaceCan(space, "roles.manage") && (
        <MenuItem icon={<ShieldCheck />} label="Roles" onSelect={later(() => onDialog("roles"))} />
      )}
      {!space.is_default && spaceCan(space, "integrations.manage") && (
        <MenuItem
          icon={<Webhook />}
          label="Integrations"
          onSelect={later(() => onDialog("integrations"))}
        />
      )}
      <MenuItem
        icon={<FolderOpen />}
        label="Shared folders"
        onSelect={later(() => onDialog("folders"))}
      />
      <MenuItem
        icon={<HardDrive />}
        label="Show drive"
        onSelect={() =>
          void driveNative
            .reveal(space.id)
            .catch(() =>
              notify({ message: "The drive couldn't be shown. Try again.", tone: "error" }),
            )
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
