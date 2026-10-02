import { spaceRequest } from "./api";
export interface SpacePersonalItem {
  item_key: string;
  favorite: boolean;
  opened_at?: string;
}
export const spacePersonalItemsApi = {
  list: (spaceId: string) =>
    spaceRequest<{ items: SpacePersonalItem[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/item-state`,
    ),
  update: (spaceId: string, itemKey: string, patch: { favorite?: boolean; opened?: boolean }) =>
    spaceRequest<SpacePersonalItem>(`/spaces/${encodeURIComponent(spaceId)}/item-state`, {
      method: "PATCH",
      body: JSON.stringify({ item_key: itemKey, ...patch }),
    }),
};
