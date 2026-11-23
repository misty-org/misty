import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import { DropdownMenu, DropdownMenuContent, MenuTrigger, Popover, PopoverAnchor } from "@misty/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/default_space";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceMenuItems } from "./SpaceMenuItems";

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
                  fit
                  className="-ml-2.5 gap-2"
                  icon={
                    <SpaceAvatar
                      space={space}
                      className="size-5 rounded-md"
                      fallbackClassName="text-micro font-semibold"
                    />
                  }
                />
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="w-60 max-w-[calc(100vw-var(--spacing)*4)]"
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
