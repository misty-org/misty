import { UsersRound } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "@/features/account";
import { switchSpaceWindow } from "@/features/app-windows";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuCheckItem,
  MenuTrigger,
  Text,
  Tooltip,
} from "@/shared/ui";
import { preferredDefaultSpace, spaceNavigationName } from "../../routes/defaultSpace";
import { useSpacesStore } from "../../list/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";
import { useWindowSpace } from "./useWindowSpace";

/*
 * The Spaces' items for the window's bottom bar (Settings › Interface › Bottom bar): the window's
 * Space, to switch it from anywhere, and who else is in it right now.
 */

/** The window's Space, opening onto the person's Spaces to show another in this window. */
export function SpaceBarMenu() {
  const space = useWindowSpace();
  const spaces = useSpacesStore((state) => state.spaces);
  if (!space) return null;
  const personal = preferredDefaultSpace(spaces);
  const ordered = personal ? [personal, ...spaces.filter((item) => item !== personal)] : spaces;
  const avatar = (item: typeof space) => (
    <SpaceAvatar space={item} className="size-4 rounded-sm" fallbackClassName="text-3xs" />
  );
  return (
    <DropdownMenu>
      <MenuTrigger label="Switch Space" value={spaceNavigationName(space)} icon={avatar(space)} />
      <DropdownMenuContent side="top" align="start">
        {ordered.map((item) => (
          <MenuCheckItem
            key={item.id}
            checked={item.id === space.id}
            closeOnSelect
            icon={avatar(item)}
            label={spaceNavigationName(item)}
            onSelect={() => {
              if (item.id !== space.id) switchSpaceWindow(item.id, item.id === personal?.id);
            }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How many other people are in the window's Space right now, named in the tooltip. */
export function SpacePresence() {
  const space = useWindowSpace();
  const { user } = useAuth();
  const viewers = useSpacesStore((state) => (space ? state.presenceBySpace[space.id] : undefined));
  const members = useSpacesStore((state) => (space ? state.membersBySpace[space.id] : undefined));
  const others = (viewers ?? []).filter((viewer) => viewer.active && viewer.user_id !== user?.id);
  useEffect(() => {
    if (space && others.length && !members) void useSpacesStore.getState().loadMembers(space.id);
  }, [space, others.length, members]);
  if (!space || !others.length) return null;
  const names = others
    .map((viewer) => members?.find((member) => member.user_id === viewer.user_id)?.name)
    .filter(Boolean);
  return (
    <Tooltip content={names.length ? names.join(", ") : `In ${spaceNavigationName(space)}`}>
      <Text bare size="control" tone="muted" className="flex h-8 items-center gap-1.5 px-2">
        <UsersRound aria-hidden="true" />
        {`${others.length} here`}
      </Text>
    </Tooltip>
  );
}
