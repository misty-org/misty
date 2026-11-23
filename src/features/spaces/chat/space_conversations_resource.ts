import { readApiAccountId } from "@/api/client/session";
import { create } from "zustand";
import { spacesApi } from "../api/api";
import type { SpaceConversation } from "../api/dto/entities";
import {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "../api/space_resource";
import { coalescedReload, coalescedReloadPending } from "../list/coalesced_reload";

const path = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/conversations`;

const useEveryoneUnread = create<{ counts: Record<string, number> }>(() => ({ counts: {} }));
const everyoneKey = (spaceId: string) => `${readApiAccountId()}:${spaceId}`;
const setEveryoneUnread = (spaceId: string, count: number) =>
  useEveryoneUnread.setState((state) =>
    state.counts[everyoneKey(spaceId)] === count
      ? state
      : { counts: { ...state.counts, [everyoneKey(spaceId)]: count } },
  );

const load = (spaceId: string) =>
  spacesApi.conversations(spaceId).then((result) => {
    setEveryoneUnread(spaceId, result.everyone_unread_count ?? 0);
    return result.conversations;
  });

export function useSpaceEveryoneUnread(spaceId: string): number {
  return useEveryoneUnread((state) => state.counts[everyoneKey(spaceId)] ?? 0);
}

const reloadKey = (spaceId: string) => `conversations:${spaceId}`;

export function reloadSpaceConversationsForMessage(spaceId: string) {
  return coalescedReload(reloadKey(spaceId), () => reloadSpaceConversations(spaceId));
}

export function markSpaceChatReadLocally(spaceId: string, conversationId: string) {
  if (!conversationId) return setEveryoneUnread(spaceId, 0);
  updateSpaceConversations(spaceId, (current) =>
    current.some((item) => item.id === conversationId && item.unread_count)
      ? current.map((item) => (item.id === conversationId ? { ...item, unread_count: 0 } : item))
      : current,
  );
}

export function spaceChatReadSaved(spaceId: string, conversationId: string) {
  markSpaceChatReadLocally(spaceId, conversationId);
  if (coalescedReloadPending(reloadKey(spaceId)))
    void reloadSpaceConversationsForMessage(spaceId).catch(() => {});
}

export function useSpaceConversationList(spaceId: string) {
  return useSpaceResource<SpaceConversation[]>(spaceId ? path(spaceId) : null, () => load(spaceId));
}

export function reloadSpaceConversations(spaceId: string) {
  return refreshSpaceResource(path(spaceId), () => load(spaceId));
}

export function updateSpaceConversations(
  spaceId: string,
  update: (current: SpaceConversation[]) => SpaceConversation[],
) {
  const current = peekSpaceResource<SpaceConversation[]>(path(spaceId));
  if (current) setSpaceResource<SpaceConversation[]>(path(spaceId), update(current));
}
