import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  NavTitleButton,
  Popover,
  PopoverAnchor,
} from "@misty/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/defaultSpace";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceMenuItems } from "./SpaceMenuItems";

/**
 * The first row of the Space's sidebar: the Space's avatar, its name in bold and a chevron, one
 * compact button that opens the Space menu (your Spaces, a new Space, inviting people for the one
 * who can, then the Space's people, shared folders, name and leaving or deleting it). A Space has
 * no home page. The name is shown whole, never faded; a Space's name is at most 64 characters.
 */
export function SpaceSelector({ space }: { space: Space }) {
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
                <DropdownMenuTrigger asChild>
                  <NavTitleButton
                    aria-label={`${name}, switch Space`}
                    name={name}
                    mark={
                      <SpaceAvatar
                        space={space}
                        className="size-4 shrink-0 rounded-sm"
                        fallbackClassName="text-3xs font-semibold"
                      />
                    }
                  />
                </DropdownMenuTrigger>
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
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
