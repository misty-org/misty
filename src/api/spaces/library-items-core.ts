import { createLibraryAssetStackApi } from "./library-asset-stacks";
import { createLibraryItemMutationApi } from "./library-items-mutations";
import { createLibraryQueryApi } from "./library-items-query";
import { createLibraryTransferApi } from "./library-items-transfers";
import type * as LibraryUploadModule from "./library-upload";
import type { SpaceRequest } from "./types";

export type LibraryTransfers = Pick<
  typeof LibraryUploadModule,
  | "downloadProtectedFile"
  | "fetchProtectedBlob"
  | "replaceLibraryItemContent"
  | "uploadLibraryBlob"
  | "uploadLibraryPath"
>;

export function createSpaceLibraryItemsApi(
  spaceRequest: SpaceRequest,
  transfers: LibraryTransfers,
) {
  return {
    ...createLibraryQueryApi(spaceRequest),
    ...createLibraryItemMutationApi(spaceRequest),
    ...createLibraryAssetStackApi(spaceRequest),
    ...createLibraryTransferApi(transfers),
  };
}
