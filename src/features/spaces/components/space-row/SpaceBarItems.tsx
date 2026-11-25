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
} from "@misty/ui";
import { preferredDefaultSpace, spaceNavigationName } from "../../routes/default_space";
import { useSpacesStore } from "../../list/use_spaces_store";
import { SpaceAvatar } from "../SpaceAvatar";
import { useWindowSpace } from "./use_window_space";

export function SpaceBarMenu() {
  const space = useWindowSpace();
  const spaces = useSpacesStore((state) => state.spaces);
  if (!space) return null;
  const personal = preferredDefaultSpace(spaces);
  const ordered = personal ? [personal, ...spaces.filter((item) => item !== personal)] : spaces;
  const avatar = (item: typeof space) => (
    <SpaceAvatar space={item} className="size-5 rounded-sm" fallbackClassName="text-micro" />
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
