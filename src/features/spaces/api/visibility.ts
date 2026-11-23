import { apiRequest } from "@/api/client";

export type ItemVisibility = "public" | "private";

export type VisibilityItemKind = "note" | "agent";

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
