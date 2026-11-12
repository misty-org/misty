import { personalSpaceId, spaceWindow, type SpaceWindowIdentity } from "@/features/app-windows";
import type { GlobalAiConversation } from "./conversationTypes";

/**
 * Whether a conversation belongs to the Space a window shows. Conversations belong to one person
 * in one Space; the list holds all of a person's, and a window shows those of its current Space.
 * A chat saved before chats carried their Space was made in the personal Space, since only there
 * did a window not know its Space's id, so it stays there.
 */
export function conversationInSpace(
  conversation: Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
  space: SpaceWindowIdentity = spaceWindow(),
  personalId: string | null = personalSpaceId(),
): boolean {
  if (conversation.personalSpace || !conversation.spaceId) return space.personal;
  return space.personal
    ? conversation.spaceId === personalId
    : conversation.spaceId === space.spaceId;
}

/**
 * The chats saved before chats carried their Space, given the personal Space's id, where they
 * were made. The same list back when there are none, so nothing is saved for nothing.
 */
export function placeUnplacedChats<
  T extends Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
>(conversations: T[], personalId: string): T[] {
  if (conversations.every((chat) => chat.spaceId)) return conversations;
  return conversations.map((chat) =>
    chat.spaceId ? chat : { ...chat, spaceId: personalId, personalSpace: true },
  );
}

/**
 * The one Space a chat works in, by id: its own, or the personal Space for a chat that is there
 * or was saved before chats carried their Space. Empty until the personal Space's id is known.
 */
export function chatSpaceId(
  conversation: Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
  personalId: string | null = personalSpaceId(),
): string {
  if (conversation.personalSpace || !conversation.spaceId) return personalId ?? "";
  return conversation.spaceId;
}
