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
/** Channels, then direct messages with agents. */
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const sorted = [...conversations].sort(byRecent);
  return [
    {
      id: "channels",
      title: "Channels",
      everyone: true,
      conversations: sorted.filter((item) => item.kind !== "direct"),
    },
    {
      id: "direct",
      title: "Direct messages",
      conversations: sorted.filter((item) => item.kind === "direct"),
    },
  ];
}
/** A chat with an agent is titled by the chat; direct messages by the other person. */
export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.direct_agent_id) return conversation.title || "New chat";
  if (conversation.kind === "direct") {
    const other = conversation.participants.find((p) => p.user_id && p.user_id !== currentUserId);
    if (other?.name) return other.name;
  }
  return conversation.title || "Conversation";
}
