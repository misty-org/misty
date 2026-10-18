export type { MetadataDialogModel, TextDialogModel } from "@/api/spaces/dto/SpaceLibraryDialogs";

import type { MetadataDialogModel, TextDialogModel } from "@/api/spaces/dto/SpaceLibraryDialogs";
import { MetadataDialog } from "./libraryDialogs/MetadataDialog";
import { TextDialog } from "./libraryDialogs/TextDialog";

/** Every Library dialog, mounted together. Each renders only when its model is open. */
export function SpaceLibraryDialogs({
  metadata,
  text,
}: {
  metadata: MetadataDialogModel;
  text: TextDialogModel;
}) {
  return (
    <>
      <MetadataDialog model={metadata} />
      <TextDialog model={text} />
    </>
  );
}
