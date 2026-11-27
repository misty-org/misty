import { useCallback, useState } from "react";
import type { Space } from "../../api/dto/entities";
import { DropdownMenu, DropdownMenuContent, MenuTrigger } from "@misty/ui";
import { spaceNavigationName } from "../../routes/default_space";
import { SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceSettingsItems } from "./SpaceMenuItems";
import { SpaceAvatar } from "../SpaceAvatar";
import { canChangeSpacePicture, useSpacePictureEditor } from "../UseSpacePictureEditor";

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
  const picture = useSpacePictureEditor(space);
  return (
    <div className="flex min-w-0 items-center">
      <DropdownMenu>
        <MenuTrigger
          heading
          label={name}
          value={name}
          mark={<SpaceAvatar space={space} className="size-10" />}
          markEdit={
            canChangeSpacePicture(space)
              ? { onEdit: picture.open, label: "Change picture", shape: "tile" }
              : undefined
          }
        />
        <DropdownMenuContent
          side="bottom"
          align="start"
          className="w-60 max-w-[calc(100vw-var(--spacing)*4)]"
        >
          <SpaceSettingsItems space={space} onDialog={setDialog} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SpaceDialogs space={space} open={dialog} onOpen={setDialog} onClose={close} />
      {picture.dialog}
    </div>
  );
}
