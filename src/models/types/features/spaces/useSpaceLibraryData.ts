import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SpaceRequestError, spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { LibraryEditDefinition } from "@/models/types/features/spaces/types";
import type {
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryAssetStack,
  LibraryDiscovery,
  LibraryGroup,
  LibraryImportHistoryItem,
  LibraryIntelligencePolicy,
  LibraryItemQuery,
  LibraryPerson,
  LibraryPinnedCollection,
  LibrarySearchFacets,
  LibrarySharedReference,
  SpaceLibraryItem,
  SpaceStorageUsage,
} from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { LibraryItemMenuState } from "@/models/interfaces/features/spaces/components/LibraryItemContextMenu";
import { compareLibraryItems, libraryFacetPrefix } from "@/features/spaces/libraryFormat";
import type {
  LibraryAlbumDialogMode,
  LibraryMetadataDialogAction,
  LibraryPersonDialogMode,
  LibraryTextDialogState,
  LibraryUnlockScope,
} from "@/models/types/features/spaces/SpaceLibraryDialogs";
import { activeSensitiveGrant, libraryItemMIME } from "@/features/spaces/SpaceLibraryPrimitives";

export type LibraryCollectionKind =
  | "recent"
  | "smart"
  | "months"
  | "years"
  | "recent-days"
  | "utility"
  | "collections"
  | "favorites"
  | "hidden"
  | "deleted"
  | "people"
  | "albums"
  | "groups"
  | "memory"
  | "trip"
  | "map"
  | "duplicate"
  | "shared"
  | "imports";

export type LibraryUploadJob = {
  id: string;
  path: string;
  name: string;
  stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed";
  progress: number;
  error?: string;
};

export type SpaceLibraryData = ReturnType<typeof useSpaceLibraryData>;
import type { useSpaceLibraryData } from "@/features/spaces/useSpaceLibraryData";
