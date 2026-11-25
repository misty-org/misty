import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import { DropdownMenu, DropdownMenuContent, MenuTrigger } from "@misty/ui";
import { spaceNavigationName } from "../../routes/default_space";
import { SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceSettingsItems } from "./SpaceMenuItems";

export function SpaceSelector({
  space,
  place = "spaces",
}: {
  space: Space;
  place?: "personal" | "spaces";
}) {
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const close = useCallback(() => setDialog(null), []);
  const name = place === "personal" ? "Personal" : spaceNavigationName(space);
  return (
    <div className="flex min-w-0 items-center">
      <DropdownMenu>
        <MenuTrigger heading label={name} value={name} />
        <DropdownMenuContent
          side="bottom"
          align="start"
          className="w-60 max-w-[calc(100vw-var(--spacing)*4)]"
        >
          <SpaceSettingsItems space={space} onDialog={setDialog} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SpaceDialogs space={space} open={dialog} onOpen={setDialog} onClose={close} />
    </div>
  );
}
