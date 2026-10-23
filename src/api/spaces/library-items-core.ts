import { createLibraryItemMutationApi } from "./library-items-mutations";
import { createLibraryQueryApi } from "./library-items-query";
import { createLibraryTransferApi } from "./library-items-transfers";
import type * as LibraryUploadModule from "./library-upload";
import type * as ProtectedDownloadModule from "./protected-download";
import type { SpaceRequest } from "./types";

export type LibraryTransfers = Pick<
  typeof LibraryUploadModule,
  "replaceLibraryItemContent" | "uploadLibraryBlob" | "uploadLibraryPath"
> &
  typeof ProtectedDownloadModule;

export function createSpaceLibraryItemsApi(
  spaceRequest: SpaceRequest,
  transfers: LibraryTransfers,
) {
  return {
    ...createLibraryQueryApi(spaceRequest),
    ...createLibraryItemMutationApi(spaceRequest),
    ...createLibraryTransferApi(transfers),
  };
}
