import { spaceWindow } from "@/features/workspace/spaceWindow";
import { normalizeConversation } from "./mistyStoreHelpers";
import type { GlobalAiConversation } from "./types";

/** A new chat. It lives in misty.db from its first save, and no server ever hears of it. */
export function newLocalConversation(
  title: string,
  spaceId?: string,
  agentId?: string,
): GlobalAiConversation {
  const now = new Date().toISOString();
  return normalizeConversation({
    id: `conversation_${crypto.randomUUID()}`,
    title,
    spaceId: spaceId ?? spaceWindow().spaceId ?? undefined,
    agentId,
    createdAt: now,
    updatedAt: now,
    messages: [],
    remote: false,
  });
}
