import type { MetadataDialogModel, TextDialogModel } from "./library-dialogs/libraryDialogTypes";
import { MetadataDialog } from "./library-dialogs/MetadataDialog";
import { TextDialog } from "./library-dialogs/TextDialog";

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
