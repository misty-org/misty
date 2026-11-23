import type { SpaceConversation } from "../../api/dto/entities";

interface ConversationGroup {
  id: string;
  title: string;
  everyone?: boolean;
  conversations: SpaceConversation[];
}
const byRecent = (left: SpaceConversation, right: SpaceConversation) =>
  right.updated_at.localeCompare(left.updated_at);
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const sorted = [...conversations].sort(byRecent);
  return [
    {
      id: "channels",
      title: "Channels",
      everyone: true,
      conversations: conversations
        .filter((conversation) => conversation.kind !== "dm")
        .sort((left, right) => left.created_at.localeCompare(right.created_at)),
    },
    {
      id: "dms",
      title: "Direct messages",
      conversations: sorted.filter((conversation) => conversation.kind === "dm"),
    },
  ];
}
export function isGroupDirectMessage(conversation: SpaceConversation, currentUserId?: string) {
  return (
    conversation.kind === "dm" &&
    conversation.participants.filter((p) => p.kind === "person" && p.user_id !== currentUserId)
      .length > 1
  );
}

export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.kind === "dm") {
    const others = conversation.participants.filter(
      (p) => (p.user_id || p.agent_id) && p.user_id !== currentUserId,
    );
    const names = others.flatMap((p) => (p.name ? [p.name] : []));
    if (names.length) return names.join(", ");
  }
  return conversation.title || "Conversation";
}

export function isPrivateChannel(conversation: SpaceConversation, defaultRoleId?: string): boolean {
  if (conversation.kind === "dm" || !defaultRoleId) return false;
  return (conversation.overwrites ?? []).some(
    (overwrite) => overwrite.role_id === defaultRoleId && overwrite.deny.includes("messages.read"),
  );
}
