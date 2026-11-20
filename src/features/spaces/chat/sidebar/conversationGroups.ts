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
      // Channels keep their place, in the order they were made, as in Discord; DMs go by recency.
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
/** A direct message with more than one other member, people or agents: it lists with the one-to-one ones. */
export function isGroupDirectMessage(conversation: SpaceConversation, currentUserId?: string) {
  return (
    conversation.kind === "dm" &&
    conversation.participants.filter((p) => p.kind === "person" && p.user_id !== currentUserId)
      .length > 1
  );
}

/** A conversation is titled by its name; a DM by the other members in it, agents included. */
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

/**
 * A channel only some roles can read: the default role's overwrite there denies reading. The
 * Space-wide channel and direct messages never are.
 */
export function isPrivateChannel(conversation: SpaceConversation, defaultRoleId?: string): boolean {
  if (conversation.kind === "dm" || !defaultRoleId) return false;
  return (conversation.overwrites ?? []).some(
    (overwrite) => overwrite.role_id === defaultRoleId && overwrite.deny.includes("messages.read"),
  );
}
