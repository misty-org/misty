import {
  AppWindowMac,
  Globe,
  House,
  LogOut,
  MessagesSquare,
  Palette,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { Space } from "@/api/spaces/dto/entities";
import {
  openSpaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
} from "@/features/workspace/spaceWindow";
import { DropdownMenuCheckboxItem, DropdownMenuSeparator, MenuItem } from "@/shared/ui";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../defaultSpace";
import { useSpacesStore } from "../../store/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";
import type { SpaceDialog } from "./SpaceDialogs";

/**
 * The Space menu: your Spaces (choosing one switches this window, with a checkmark on the
 * one it shows), the Space in a new window, a new Space, then this Space's name, color,
 * sites and leaving or deleting it. In the collapsed sidebar it also carries Home,
 * Chat and People.
 */
export function SpaceMenuItems(props: {
  space: Space;
  compact: boolean;
  onPage: (page: "home" | "chat") => void;
  onDialog: (dialog: SpaceDialog) => void;
  onCreate: () => void;
  onError: (message: string) => void;
}) {
  const { space, onDialog } = props;
  const spaces = useSpacesStore((state) => state.spaces);
  const incognito = useSpaceWindowStore((state) => state.identity.incognito);
  const personal = preferredDefaultSpace(spaces);
  const isOwner = space.role === "owner";
  const report = (action: Promise<unknown>) =>
    void action.catch(() => props.onError("That Space couldn't open. Try again."));
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
              if (!here) report(switchSpaceWindow(item.id, isPersonal));
            }}
          >
            <SpaceAvatar
              space={item}
              className="size-5 rounded-md"
              fallbackClassName="text-[9px] font-semibold"
            />
            <span className="min-w-0 flex-1 truncate">{spaceNavigationName(item)}</span>
          </DropdownMenuCheckboxItem>
        );
      })}
    </>
  );
  const windowItems = (
    <>
      <MenuItem
        icon={<AppWindowMac className="size-4" />}
        label="Open in new window"
        onSelect={() => report(openSpaceWindow(space.id, space.id === personal?.id))}
      />
      <MenuItem
        icon={<Plus className="size-4" />}
        label="New Space"
        onSelect={later(props.onCreate)}
      />
    </>
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
      {!incognito && (
        <MenuItem
          icon={<Palette className="size-4" />}
          label="Color"
          onSelect={later(() => onDialog("color"))}
        />
      )}
      <MenuItem
        icon={<Globe className="size-4" />}
        label="Sites that open here"
        onSelect={later(() => onDialog("sites"))}
      />
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
      {props.compact && (
        <>
          <MenuItem
            icon={<House className="size-4" />}
            label="Home"
            onSelect={() => props.onPage("home")}
          />
          <MenuItem
            icon={<MessagesSquare className="size-4" />}
            label="Chat"
            onSelect={() => props.onPage("chat")}
          />
          <MenuItem
            icon={<UsersRound className="size-4" />}
            label="People"
            onSelect={later(() => onDialog("members"))}
          />
          <DropdownMenuSeparator />
        </>
      )}
      {spaceList}
      <DropdownMenuSeparator />
      {windowItems}
      <DropdownMenuSeparator />
      {settings}
    </>
  );
}
