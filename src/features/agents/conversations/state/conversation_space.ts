import { personalSpaceId, spaceWindow, type SpaceWindowIdentity } from "@/features/app-windows";
import type { GlobalAiConversation } from "./conversation_types";

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

export function placeUnplacedChats<
  T extends Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
>(conversations: T[], personalId: string): T[] {
  if (conversations.every((chat) => chat.spaceId)) return conversations;
  return conversations.map((chat) =>
    chat.spaceId ? chat : { ...chat, spaceId: personalId, personalSpace: true },
  );
}

export function chatSpaceId(
  conversation: Pick<GlobalAiConversation, "spaceId" | "personalSpace">,
  personalId: string | null = personalSpaceId(),
): string {
  if (conversation.personalSpace || !conversation.spaceId) return personalId ?? "";
  return conversation.spaceId;
}
