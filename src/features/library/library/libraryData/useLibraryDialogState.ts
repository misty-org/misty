import type {
  LibraryMetadataDialogAction,
  LibraryTextDialogState,
} from "@/api/spaces/dto/SpaceLibraryDialogs";
import { useState } from "react";

/** Draft state for the Library's dialogs: metadata and the text prompt. */
export function useLibraryDialogState() {
  const [metadataDialogAction, setMetadataDialogAction] = useState<LibraryMetadataDialogAction>("");
  const [metadataTags, setMetadataTags] = useState("");
  const [metadataDate, setMetadataDate] = useState("");
  const [metadataLocationName, setMetadataLocationName] = useState("");
  const [metadataLatitude, setMetadataLatitude] = useState("");
  const [metadataLongitude, setMetadataLongitude] = useState("");

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
