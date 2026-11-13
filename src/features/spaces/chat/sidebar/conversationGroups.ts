import type { SpaceConversation } from "../../api/dto/entities";

interface ConversationGroup {
  id: string;
  title: string;
  /** Only channels include the Space-wide "Everyone" conversation. */
  everyone?: boolean;
  conversations: SpaceConversation[];
}
const byRecent = (left: SpaceConversation, right: SpaceConversation) =>
  right.updated_at.localeCompare(left.updated_at);
/** The Space's channels, which everyone in it sees, and DMs, which only their people see. */
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const sorted = [...conversations].sort(byRecent);
  return [
    {
      id: "channels",
      title: "Channels",
      everyone: true,
      conversations: sorted.filter((conversation) => conversation.kind !== "dm"),
    },
    {
      id: "dms",
      title: "Direct messages",
      conversations: sorted.filter((conversation) => conversation.kind === "dm"),
    },
  ];
}
/** A conversation is titled by its name; a DM by the other people in it. */
export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.kind === "dm") {
    const others = conversation.participants.filter(
      (p) => p.user_id && p.user_id !== currentUserId,
    );
    const names = others.flatMap((p) => (p.name ? [p.name] : []));
    if (names.length) return names.join(", ");
  }
  return conversation.title || "Conversation";
}
