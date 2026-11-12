import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuTrigger,
  Popover,
  PopoverAnchor,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/defaultSpace";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceMenuItems } from "./SpaceMenuItems";

/**
 * The Space page's title: the Space's avatar and name, opening onto the Spaces to switch this
 * window to, a new Space, and inviting people to this one.
 */
export function SpaceSwitcher({ space }: { space: Space }) {
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const close = useCallback(() => setDialog(null), []);
  const name = spaceNavigationName(space);
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div className="flex min-w-0 items-center">
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu>
                <MenuTrigger
                  label={`${name}, switch Space`}
                  value={name}
                  className="-ml-2 h-8 max-w-full gap-2 px-2 text-sm font-semibold text-cream-bright"
                  icon={
                    <SpaceAvatar
                      space={space}
                      className="size-5 rounded-md"
                      fallbackClassName="text-3xs font-semibold"
                    />
                  }
                />
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="w-60 max-w-[calc(100vw-16px)]"
                >
                  <SpaceMenuItems space={space} onDialog={setDialog} onCreate={create} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </GlobalCreateSpaceDialog>
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
