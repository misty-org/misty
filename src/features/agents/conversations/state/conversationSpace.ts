import { spaceWindow, type SpaceWindowIdentity } from "@/features/app-windows";
import type { GlobalAiConversation } from "./conversationTypes";

/**
 * Whether a conversation belongs to the Space a window shows. Conversations belong to one person
 * in one Space; the list holds all of a person's, and a window shows those of its current Space.
 */
export function conversationInSpace(
  conversation: Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
  space: SpaceWindowIdentity = spaceWindow(),
): boolean {
  // One still being created has no Space yet, and belongs to the window that made it.
  if (!conversation.spaceId) return true;
  return space.personal
    ? Boolean(conversation.personalSpace)
    : conversation.spaceId === space.spaceId;
}
