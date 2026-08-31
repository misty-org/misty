export type {
  AlbumDialogModel,
  LibraryAlbumDialogMode,
  LibraryMetadataDialogAction,
  LibraryPersonDialogMode,
  LibraryTextDialogState,
  LibraryUnlockScope,
  MetadataDialogModel,
  PersonDialogModel,
  TextDialogModel,
  UnlockDialogModel,
} from "@/api/spaces/dto/types/SpaceLibraryDialogs";

import type {
  AlbumDialogModel,
  MetadataDialogModel,
  PersonDialogModel,
  TextDialogModel,
  UnlockDialogModel,
} from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import { AlbumDialog } from "./libraryDialogs/AlbumDialog";
import { MetadataDialog } from "./libraryDialogs/MetadataDialog";
import { PersonDialog } from "./libraryDialogs/PersonDialog";
import { TextDialog } from "./libraryDialogs/TextDialog";
import { UnlockDialog } from "./libraryDialogs/UnlockDialog";

/** Every Library dialog, mounted together. Each renders only when its model is open. */
export function SpaceLibraryDialogs({
  album,
  person,
  metadata,
  text,
  unlock,
}: {
  album: AlbumDialogModel;
  person: PersonDialogModel;
  metadata: MetadataDialogModel;
  text: TextDialogModel;
  unlock: UnlockDialogModel;
}) {
  return (
    <>
      <AlbumDialog model={album} />
      <PersonDialog model={person} />
      <MetadataDialog model={metadata} />
      <TextDialog model={text} />
      <UnlockDialog model={unlock} />
    </>
  );
}
