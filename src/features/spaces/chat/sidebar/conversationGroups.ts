import type { SpaceConversation } from "@/api/spaces/dto/entities";

export interface ConversationGroup {
  id: string;
  title: string;
  /** Only channels include the Space-wide "Everyone" conversation. */
  everyone?: boolean;
  conversations: SpaceConversation[];
}
const byRecent = (left: SpaceConversation, right: SpaceConversation) =>
  right.updated_at.localeCompare(left.updated_at);
/** The Space's channels and conversations with people. */
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const sorted = [...conversations].sort(byRecent);
  return [
    {
      id: "channels",
      title: "Channels",
      everyone: true,
      conversations: sorted,
    },
  ];
}
/** A conversation is titled by its name; a direct one by the other person. */
export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.kind === "direct") {
    const other = conversation.participants.find((p) => p.user_id && p.user_id !== currentUserId);
    if (other?.name) return other.name;
  }
  return conversation.title || "Conversation";
}
