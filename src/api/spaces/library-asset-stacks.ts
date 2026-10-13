import type { LibraryAssetStack } from "@/api/spaces/dto/entities";

import { libraryReauthenticationHeaders } from "./library-transfer-paths";
import type { SpaceRequest } from "./types";

export function createLibraryAssetStackApi(spaceRequest: SpaceRequest) {
  return {
    libraryAssetStacks: (spaceId: string) =>
      spaceRequest<{ stacks: LibraryAssetStack[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`,
      ),
    createLibraryAssetStack: (
      spaceId: string,
      input: Pick<
        LibraryAssetStack,
        "kind" | "title" | "cover_item_id" | "motion_item_id" | "members"
      >,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryAssetStack>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`,
        {
          method: "POST",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify(input),
        },
      ),
    updateLibraryAssetStack: (
      spaceId: string,
      stack: LibraryAssetStack,
      patch: Partial<Pick<LibraryAssetStack, "title" | "cover_item_id" | "effect">>,
      reauthenticationToken = "",
    ) =>
      spaceRequest<LibraryAssetStack>(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}`,
        {
          method: "PATCH",
          headers: libraryReauthenticationHeaders(reauthenticationToken),
          body: JSON.stringify({
            version: stack.version,
            title: patch.title ?? stack.title,
            cover_item_id: patch.cover_item_id ?? stack.cover_item_id,
            effect: patch.effect ?? stack.effect ?? "still",
          }),
        },
      ),
    deleteLibraryAssetStack: (
      spaceId: string,
      stack: LibraryAssetStack,
      reauthenticationToken = "",
    ) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}?version=${stack.version}`,
        { method: "DELETE", headers: libraryReauthenticationHeaders(reauthenticationToken) },
      ),
  };
}
