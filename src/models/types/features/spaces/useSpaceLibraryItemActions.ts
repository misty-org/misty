import { useEffect, type FormEvent } from "react";
import { confirmAction } from "@/lib/confirmAction";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import {
  copyBlobFilesToClipboard,
  copyLibraryItemsToClipboard,
} from "@/features/spaces/libraryClipboard";
import type { BulkLibraryItemAction } from "@/models/types/features/spaces/types";
import type {
  BulkLibraryItemOptions,
  LibraryAssetStack,
  LibrarySharedReference,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";
import {
  buildLibraryAssetStack,
  detectUploadedAssetStacks,
  libraryItemMIME,
} from "@/features/spaces/SpaceLibraryPrimitives";
import type {
  LibraryUploadJob,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";

export type SpaceLibraryItemActions = ReturnType<typeof useSpaceLibraryItemActions>;
import type { useSpaceLibraryItemActions } from "@/features/spaces/useSpaceLibraryItemActions";
