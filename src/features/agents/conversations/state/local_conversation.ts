import { personalSpaceId, spaceForNewItems } from "@/features/app-windows";
import { normalizeConversation } from "./misty_store_updates";
import type { GlobalAiConversation } from "./conversation_types";

export function newLocalConversation(
  title: string,
  spaceId?: string,
  agentId?: string,
  place?: GlobalAiConversation["place"],
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
    place,
    createdAt: now,
    updatedAt: now,
    messages: [],
    remote: false,
  });
}
