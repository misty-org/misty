import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";

export interface ConversationGroup {
  id: string;
  title: string;
  /** Only channels include the Space-wide "Everyone" conversation. */
  everyone?: boolean;
  conversations: SpaceConversation[];
}
const byRecent = (left: SpaceConversation, right: SpaceConversation) =>
  right.updated_at.localeCompare(left.updated_at);
/** Channels, then direct messages. */
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const visible = conversations.filter((item) => !item.direct_agent_id).sort(byRecent);
  return [
    {
      id: "channels",
      title: "Channels",
      everyone: true,
      conversations: visible.filter((item) => item.kind !== "direct"),
    },
    {
      id: "direct",
      title: "Direct messages",
      conversations: visible.filter((item) => item.kind === "direct"),
    },
  ];
}
/** Direct messages are titled by the other person; everything else by its own name. */
export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.kind === "direct") {
    const other = conversation.participants.find((p) => p.user_id && p.user_id !== currentUserId);
    if (other?.name) return other.name;
  }
  return conversation.title || "Conversation";
}
