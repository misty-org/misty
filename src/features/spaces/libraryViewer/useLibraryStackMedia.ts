import { useEffect, useState } from "react";
import type {
  LibraryAssetStack,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import { libraryMediaKind, type LibraryMediaKind } from "./libraryMediaKind";

export interface LibraryStackMedia extends LibraryMediaKind {
  stackMemberID: string;
  setStackMemberID: (id: string) => void;
  stackMediaID: string;
  stackMediaItem: SpaceLibraryItem | null;
  stackMediaMember: LibraryAssetStack["members"][number] | undefined;
  stackMediaMIME: string;
  displayName: string;
}

/**
 * Tracks which member of an asset stack is on screen.
 *
 * Live Photos and RAW pairs bundle several items under one cover, so the viewer
 * shows the cover by default and swaps to a sibling when one is picked. An
 * empty selection means "the cover", which keeps the reset below trivial.
 */
export function useLibraryStackMedia(options: {
  item: SpaceLibraryItem | null;
  allItems: SpaceLibraryItem[];
  assetStack: LibraryAssetStack | null;
}): LibraryStackMedia {
  const { item, allItems, assetStack } = options;
  const [stackMemberID, setStackMemberID] = useState("");

  useEffect(() => {
    setStackMemberID("");
  }, [assetStack?.id, item?.id]);

  const stackMediaID = stackMemberID || item?.id || "";
  const stackMediaItem =
    allItems.find((candidate) => candidate.id === stackMediaID) ??
    (item?.id === stackMediaID ? item : null);
  const stackMediaMember = assetStack?.members.find((member) => member.item_id === stackMediaID);
  const stackMediaMIME = stackMediaItem
    ? libraryItemMIME(stackMediaItem)
    : String(stackMediaMember?.mime_type ?? "application/octet-stream")
        .split(";")[0]
        .toLowerCase();

  return {
    stackMemberID,
    setStackMemberID,
    stackMediaID,
    stackMediaItem,
    stackMediaMember,
    stackMediaMIME,
    displayName:
      stackMediaItem?.display_name ?? stackMediaMember?.display_name ?? item?.display_name ?? "",
    ...libraryMediaKind(stackMediaMIME, stackMediaItem?.file.intrinsic_metadata ?? {}),
  };
}
