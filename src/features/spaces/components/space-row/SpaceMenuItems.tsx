import { BellOff, HardDrive, LogOut, Plus, Settings, UserPlus, UsersRound } from "lucide-react";
import type { Space } from "../../api/dto/entities";
import { switchSpaceWindow } from "@/features/app-windows";
import { DropdownMenuSeparator, MenuCheckItem, MenuItem, notify } from "@misty/ui";
import { driveNative } from "../../drive/drive_native";
import { muteWithNotice, setMuted, useMessageNotices } from "@/shared/lib/message_notices";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../routes/default_space";
import { spaceSettingsPages } from "../../settings/space_settings_pages";
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
                className="size-6 rounded-md"
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
  const muted = useMessageNotices((state) => state.value.muted.includes(space.id));
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  const pages = spaceSettingsPages(space);
  const canInvite = !space.is_default && spaceCan(space, "space.invite");
  const canLeave =
    !space.is_default && space.role !== "owner" && canManageSpaceLifecycle(space, "leave");
  const settings = pages.some((page) => page !== "people");
  return (
    <>
      {canInvite ? (
        <MenuItem
          icon={<UserPlus />}
          label="Invite people"
          onSelect={later(() => onDialog("invite"))}
        />
      ) : null}
      {settings ? (
        <MenuItem
          icon={<Settings />}
          label="Space settings"
          onSelect={later(() => onDialog(pages[0]!))}
        />
      ) : pages.includes("people") ? (
        <MenuItem icon={<UsersRound />} label="People" onSelect={later(() => onDialog("people"))} />
      ) : null}
      {canInvite || pages.length ? <DropdownMenuSeparator /> : null}
      <MenuItem
        icon={<HardDrive />}
        label="Show in Finder"
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
        onSelect={() =>
          muted
            ? setMuted(space.id, false)
            : muteWithNotice(space.id, "Notifications off for this Space")
        }
      />
      {canLeave ? (
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
