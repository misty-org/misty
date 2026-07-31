import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
} from "@/models/interfaces/features/spaces/types";

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];
const emptyAgents: SpaceStudioResource[] = [];

export function useSpaceChatStore() {
  return useSpacesStore(
    useShallow((state) => ({
      messagesBySpace: state.messagesBySpace,
      membersBySpace: state.membersBySpace,
      nodesBySpace: state.nodesBySpace,
      agentsBySpace: state.agentsBySpace,
      loading: state.loading,
      sending: state.sending,
      sendMessage: state.sendMessage,
      updateMessage: state.updateMessage,
      deleteMessage: state.deleteMessage,
      toggleMessageReaction: state.toggleMessageReaction,
      markRead: state.markRead,
      loadMessages: state.loadMessages,
      loadChatAgents: state.loadChatAgents,
      openNode: state.openNode,
      clearSpacesError: state.clearError,
    })),
  );
}

/**
 * Narrows the Space's people and messages down to the active conversation.
 *
 * With no conversation in the URL this is the Space-wide chat, so the full
 * member list and the Space's own message list are used unchanged.
 */
export function useSpaceChatScope(options: {
  spaceId: string;
  conversationId: string;
  currentUserId: string | undefined;
  conversations: SpaceConversation[];
  conversationMessages: SpaceMessage[];
  store: ReturnType<typeof useSpaceChatStore>;
}) {
  const { spaceId, conversationId, currentUserId, conversations, store } = options;
  const allMembers = store.membersBySpace[spaceId] ?? emptyMembers;
  const defaultMessages = store.messagesBySpace[spaceId] ?? emptyMessages;

  const activeConversation = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const allowedMemberIds = useMemo(
    () => new Set(activeConversation?.members.map((member) => member.user_id) ?? []),
    [activeConversation],
  );
  const directRecipient = useMemo(() => {
    if (!activeConversation || activeConversation.members.length > 2) return undefined;
    const other =
      activeConversation.members.find((member) => member.user_id !== currentUserId) ??
      activeConversation.members[0];
    return other ? { userId: other.user_id, name: other.name } : undefined;
  }, [activeConversation, currentUserId]);
  const nodes = useMemo(
    () => (store.nodesBySpace[spaceId] ?? emptyNodes).filter((node) => node.kind === "link"),
    [store.nodesBySpace, spaceId],
  );

  return {
    allMembers,
    defaultMessages,
    activeConversation,
    directRecipient,
    nodes,
    agents: store.agentsBySpace[spaceId] ?? emptyAgents,
    members: conversationId
      ? allMembers.filter((member) => allowedMemberIds.has(member.user_id))
      : allMembers,
    messages: conversationId ? options.conversationMessages : defaultMessages,
  };
}
