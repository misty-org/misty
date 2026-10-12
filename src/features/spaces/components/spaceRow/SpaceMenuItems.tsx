import {
  AppWindowMac,
  Globe,
  House,
  LogOut,
  MessagesSquare,
  Palette,
  Pencil,
  Plug,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { Space } from "@/api/spaces/dto/entities";
import {
  openSpaceWindow,
  setSpaceColor,
  switchSpaceWindow,
  useSpaceWindowStore,
} from "@/features/workspace/spaceWindow";
import { windowColorHex, windowColorNames } from "@/features/workspace/windowColors";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  MenuItem,
} from "@/shared/ui";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "../../defaultSpace";
import { useSpacesStore } from "../../store/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";
import type { SpaceDialog } from "./SpaceDialogs";

const colorLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The Space menu: your Spaces (choosing one switches this window, with a checkmark on the
 * one it shows), the Space in a new window, a new Space, then this Space's name, color,
 * apps, sites and leaving or deleting it. In the collapsed sidebar it also carries Home,
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
  const color = useSpaceWindowStore((state) => state.space?.color);
  const incognito = useSpaceWindowStore((state) => state.identity.incognito);
  const personal = preferredDefaultSpace(spaces);
  const isOwner = space.role === "owner";
  const report = (action: Promise<unknown>) =>
    void action.catch(() => props.onError("That Space couldn't open. Try again."));
  const later = (run: () => void) => () => window.setTimeout(run, 0);
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
      <DropdownMenuSeparator />
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
      <DropdownMenuSeparator />
      {isOwner && canManageSpaceLifecycle(space, "rename") && (
        <MenuItem
          icon={<Pencil className="size-4" />}
          label="Rename"
          onSelect={later(() => onDialog("rename"))}
        />
      )}
      {!incognito && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="size-4" />
            <span className="min-w-0 flex-1 truncate">Color</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 max-w-[calc(100vw-16px)]">
            {windowColorNames.map((name) => (
              <DropdownMenuCheckboxItem
                key={name}
                checked={color === name}
                onSelect={() => report(setSpaceColor(name))}
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: windowColorHex(name) }}
                />
                <span className="min-w-0 flex-1 truncate">{colorLabel(name)}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <MenuItem
        icon={<Plug className="size-4" />}
        label="Apps"
        onSelect={later(() => onDialog("apps"))}
      />
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
}
