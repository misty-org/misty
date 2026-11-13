import { personalSpaceId, spaceForNewItems } from "@/features/app-windows";
import { normalizeConversation } from "./mistyStoreUpdates";
import type { GlobalAiConversation } from "./conversationTypes";

/**
 * A new chat. It lives in misty.db from its first save, and no server ever hears of it. It works in
 * one Space at a time: the one asked for, or else the one this window shows, by id.
 */
export function newLocalConversation(
  title: string,
  spaceId?: string,
  agentId?: string,
): GlobalAiConversation {
  const now = new Date().toISOString();
  const here = spaceForNewItems();
  const space = spaceId || here.spaceId || undefined;
  const personal = spaceId ? spaceId === personalSpaceId() : here.personal;
  return normalizeConversation({
    id: `conversation_${crypto.randomUUID()}`,
    title,
    spaceId: space,
    personalSpace: personal || undefined,
    agentId,
    createdAt: now,
    updatedAt: now,
    messages: [],
    remote: false,
  });
}
