import { ChevronDown, UserPlus } from "lucide-react";
import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuTrigger,
  Popover,
  PopoverAnchor,
  Pressable,
  Text,
} from "@misty/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/defaultSpace";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceMenuItems } from "./SpaceMenuItems";

/**
 * The first row of the Space's sidebar, inset like a row so its icon sits in the rows' mark column and its
 * name where their labels start: the Space's icon and its name in bold, which opens the Space's home,
 * a small chevron, which opens the switcher (your Spaces, a new Space), and Invite at the right for the one
 * who can. The name is shown whole, never faded; a Space's name is at most 64 characters.
 */
export function SpaceSelector({ space, onOpenHome }: { space: Space; onOpenHome(): void }) {
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const close = useCallback(() => setDialog(null), []);
  const name = spaceNavigationName(space);
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div className="flex min-h-9 min-w-0 items-center gap-1 pl-2 pr-1">
          <Pressable
            onClick={onOpenHome}
            aria-label={`${name}, open home`}
            className="flex min-w-0 items-center gap-2 rounded-md"
          >
            <SpaceAvatar
              space={space}
              className="size-4 shrink-0 rounded-sm"
              fallbackClassName="text-3xs font-semibold"
            />
            <Text tone="bright" size="body" weight="semibold" wrap className="min-w-0 break-words">
              {name}
            </Text>
          </Pressable>
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu>
                <MenuTrigger label="Switch Space" iconOnly icon={ChevronDown} />
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="w-60 max-w-[calc(100vw-1rem)]"
                >
                  <SpaceMenuItems space={space} onDialog={setDialog} onCreate={create} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </GlobalCreateSpaceDialog>
          {space.role === "owner" ? (
            <IconButton
              label="Invite people"
              variant="quiet"
              className="ml-auto"
              onClick={() => setDialog("invite")}
            >
              <UserPlus />
            </IconButton>
          ) : null}
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
