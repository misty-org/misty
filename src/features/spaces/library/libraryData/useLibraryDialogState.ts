import type {
  LibraryAlbumDialogMode,
  LibraryMetadataDialogAction,
  LibraryPersonDialogMode,
  LibraryTextDialogState,
} from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import { useState } from "react";

/** Draft state for every Library dialog: album, person, metadata and the text prompt. */
export function useLibraryDialogState() {
  const [metadataDialogAction, setMetadataDialogAction] = useState<LibraryMetadataDialogAction>("");
  const [metadataTags, setMetadataTags] = useState("");
  const [metadataDate, setMetadataDate] = useState("");
  const [metadataLocationName, setMetadataLocationName] = useState("");
  const [metadataLatitude, setMetadataLatitude] = useState("");
  const [metadataLongitude, setMetadataLongitude] = useState("");

  const [albumDialogMode, setAlbumDialogMode] = useState<LibraryAlbumDialogMode>("");
  const [albumName, setAlbumName] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [albumCoverItemId, setAlbumCoverItemId] = useState("");
  const [albumSaving, setAlbumSaving] = useState(false);
  const [draggedAlbumItemId, setDraggedAlbumItemId] = useState("");

  const [personDialogMode, setPersonDialogMode] = useState<LibraryPersonDialogMode>("");
  const [personName, setPersonName] = useState("");
  const [personKind, setPersonKind] = useState<"person" | "pet">("person");
  const [personCoverItemId, setPersonCoverItemId] = useState("");
  const [personSaving, setPersonSaving] = useState(false);

  const [textDialog, setTextDialog] = useState<LibraryTextDialogState | null>(null);
  const [textDialogSaving, setTextDialogSaving] = useState(false);
  const [textDialogError, setTextDialogError] = useState("");

  return {
    metadataDialogAction,
    setMetadataDialogAction,
    metadataTags,
    setMetadataTags,
    metadataDate,
    setMetadataDate,
    metadataLocationName,
    setMetadataLocationName,
    metadataLatitude,
    setMetadataLatitude,
    metadataLongitude,
    setMetadataLongitude,
    albumDialogMode,
    setAlbumDialogMode,
    albumName,
    setAlbumName,
    albumDescription,
    setAlbumDescription,
    albumCoverItemId,
    setAlbumCoverItemId,
    albumSaving,
    setAlbumSaving,
    draggedAlbumItemId,
    setDraggedAlbumItemId,
    personDialogMode,
    setPersonDialogMode,
    personName,
    setPersonName,
    personKind,
    setPersonKind,
    personCoverItemId,
    setPersonCoverItemId,
    personSaving,
    setPersonSaving,
    textDialog,
    setTextDialog,
    textDialogSaving,
    setTextDialogSaving,
    textDialogError,
    setTextDialogError,
    showTextDialog: (dialog: LibraryTextDialogState) => {
      setTextDialogError("");
      setTextDialog(dialog);
    },
  };
}
