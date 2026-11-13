import { readApiAccountId } from "@/api/client/session";
import { create } from "zustand";
import { spacesApi } from "../api/api";
import type { SpaceConversation } from "../api/dto/entities";
import {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "../api/spaceResource";
import { coalescedReload, coalescedReloadPending } from "../list/coalescedReload";

const path = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/conversations`;

/**
 * Everyone's unread count, which comes with the conversation list but isn't a conversation.
 * Keyed by account and Space, so one account never shows another's.
 */
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

/** How many messages in the Space's Everyone chat the person hasn't read. */
export function useSpaceEveryoneUnread(spaceId: string): number {
  return useEveryoneUnread((state) => state.counts[everyoneKey(spaceId)] ?? 0);
}

const reloadKey = (spaceId: string) => `conversations:${spaceId}`;

/**
 * Reads the conversation list again after a message came in, for its unread counts. A burst of
 * messages shares one or two reads.
 */
export function reloadSpaceConversationsForMessage(spaceId: string) {
  return coalescedReload(reloadKey(spaceId), () => reloadSpaceConversations(spaceId));
}

/** The person has read a chat ("" is Everyone): its unread mark goes at once. */
export function markSpaceChatReadLocally(spaceId: string, conversationId: string) {
  if (!conversationId) return setEveryoneUnread(spaceId, 0);
  updateSpaceConversations(spaceId, (current) =>
    current.some((item) => item.id === conversationId && item.unread_count)
      ? current.map((item) => (item.id === conversationId ? { ...item, unread_count: 0 } : item))
      : current,
  );
}

/**
 * The server has the read. A list read still in flight may have counted from before it, so the
 * mark goes again and one more read follows.
 */
export function spaceChatReadSaved(spaceId: string, conversationId: string) {
  markSpaceChatReadLocally(spaceId, conversationId);
  if (coalescedReloadPending(reloadKey(spaceId)))
    void reloadSpaceConversationsForMessage(spaceId).catch(() => {});
}

/**
 * A Space's conversations, the one copy the chat sidebar, the open chat, the home page and the
 * overview all read: the last list paints at once and a fresh one follows. `spaceId` empty holds
 * off.
 */
export function useSpaceConversationList(spaceId: string) {
  return useSpaceResource<SpaceConversation[]>(spaceId ? path(spaceId) : null, () => load(spaceId));
}

/** Reads a Space's conversations again for every screen that shows them. */
export function reloadSpaceConversations(spaceId: string) {
  return refreshSpaceResource(path(spaceId), () => load(spaceId));
}

/**
 * Changes a Space's conversations everywhere they show, such as after one is made here. With no
 * copy yet there is nothing to change: the first read brings the whole list.
 */
export function updateSpaceConversations(
  spaceId: string,
  update: (current: SpaceConversation[]) => SpaceConversation[],
) {
  const current = peekSpaceResource<SpaceConversation[]>(path(spaceId));
  if (current) setSpaceResource<SpaceConversation[]>(path(spaceId), update(current));
}
