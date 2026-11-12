import { MoreHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverAnchor,
} from "@/shared/ui";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceSettingsItems } from "./SpaceMenuItems";

/** The ⋯ beside a Space's Home search: its people, and renaming, leaving or deleting it. */
export function SpaceOptionsMenu({ space }: { space: Space }) {
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const close = useCallback(() => setDialog(null), []);
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`${space.name} options`}>
                <MoreHorizontal className="size-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <SpaceSettingsItems space={space} onDialog={setDialog} />
            </DropdownMenuContent>
          </DropdownMenu>
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
