import { apiRequest } from "@/api/client";

/**
 * A Space item's layer. A private item stays in the Space but opens only for its owner,
 * and for the owner's own agents on runs the owner asked for.
 */
export type ItemVisibility = "public" | "private";

/** The Space items with a private/public toggle. Channels, threads and DMs have none. */
export type VisibilityItemKind = "note" | "drawing" | "library_item" | "code_project" | "agent";

/** Only the item's owner can flip it. */
export async function setItemVisibility(
  spaceId: string,
  kind: VisibilityItemKind,
  itemId: string,
  visibility: ItemVisibility,
): Promise<void> {
  const part = encodeURIComponent;
  await apiRequest<unknown>(
    `/spaces/${part(spaceId)}/items/${part(kind)}/${part(itemId)}/visibility`,
    { method: "PUT", body: JSON.stringify({ visibility }) },
  );
}
