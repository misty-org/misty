import { createSpaceLibraryItemsApi as createItems } from "./library-items-core";
import * as uploads from "./library-upload";
import { downloadProtectedFile, fetchProtectedBlob } from "./protected-download";
import type { SpaceRequest } from "./types";
export function createSpaceLibraryItemsApi(request: SpaceRequest) {
  return createItems(request, { ...uploads, downloadProtectedFile, fetchProtectedBlob });
}
