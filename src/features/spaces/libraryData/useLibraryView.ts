import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { LibraryItemQuery } from "@/models/interfaces/features/spaces/types";
import type { LibraryCollectionKind } from "@/models/types/features/spaces/useSpaceLibraryData";

export type LibraryMediaType = "" | NonNullable<LibraryItemQuery["media_type"]>;

/** Which collection is open and how its items are sorted and presented. */
export function useLibraryView() {
  const [librarySearchParams, setLibrarySearchParams] = useSearchParams();
  const [collection, setCollection] = useState<LibraryCollectionKind>("recent");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedAlbumFolderId, setSelectedAlbumFolderId] = useState("");
  const [mediaType, setMediaType] = useState<LibraryMediaType>("");
  const [libraryViewMode, setLibraryViewMode] = useState<"grid" | "list">("grid");
  const [libraryItemScale, setLibraryItemScale] = useState(1);
  const [sort, setSort] = useState<NonNullable<LibraryItemQuery["sort"]>>("recently-added");
  const [direction, setDirection] = useState<NonNullable<LibraryItemQuery["direction"]>>("desc");

  return {
    librarySearchParams,
    setLibrarySearchParams,
    requestedCollection: librarySearchParams.get("collection"),
    requestedCollectionId: librarySearchParams.get("collectionId") ?? "",
    collection,
    setCollection,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedAlbumFolderId,
    setSelectedAlbumFolderId,
    mediaType,
    setMediaType,
    libraryViewMode,
    setLibraryViewMode,
    libraryItemScale,
    setLibraryItemScale,
    sort,
    setSort,
    direction,
    setDirection,
  };
}
