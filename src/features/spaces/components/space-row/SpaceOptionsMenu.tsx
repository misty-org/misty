import { FolderPlus, MoreHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import { currentSpaceKey, useSpaceFolders } from "@/features/agents";
import { linkSpaceFolder } from "../../home/ProjectFoldersCard";
import type { Space } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  Popover,
  PopoverAnchor,
  useNotice,
} from "@/shared/ui";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceSettingsItems } from "./SpaceMenuItems";

/**
 * The ⋯ beside a Space's Home search: linking a project folder while the Space has none (then
 * the home's Project folders block takes it over), its people, and renaming, leaving or deleting it.
 */
export function SpaceOptionsMenu({ space }: { space: Space }) {
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const close = useCallback(() => setDialog(null), []);
  const noFolders = useSpaceFolders((state) => state.folders[currentSpaceKey()]?.length === 0);
  const [linkError, setLinkError] = useState("");
  useNotice(Boolean(linkError), {
    message: linkError,
    tone: "error",
    onDismiss: () => setLinkError(""),
  });
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`${space.name} options`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {noFolders ? (
                <>
                  <MenuItem
                    icon={FolderPlus}
                    label="Link a folder"
                    onSelect={() =>
                      void linkSpaceFolder().catch(() =>
                        setLinkError("Couldn't link that folder. Try again."),
                      )
                    }
                  />
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <SpaceSettingsItems space={space} onDialog={setDialog} />
            </DropdownMenuContent>
          </DropdownMenu>
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
