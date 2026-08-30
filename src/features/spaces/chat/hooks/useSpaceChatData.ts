import { useSpacesStore } from "@/features/spaces";
import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
} from "@/api/spaces/dto/interfaces/types";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];
const emptyAgents: SpaceStudioResource[] = [];

export function useSpaceChatStore() {
  return useSpacesStore(
    useShallow((state) => ({
      messagesBySpace: state.messagesBySpace,
      messageLoadingBySpace: state.messageLoadingBySpace,
      messageErrorsBySpace: state.messageErrorsBySpace,
      membersBySpace: state.membersBySpace,
      nodesBySpace: state.nodesBySpace,
      agentsBySpace: state.agentsBySpace,
      loading: state.loading,
      sending: state.sending,
      referenceOnly: state.referenceOnly,
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
    () =>
      new Set(
        activeConversation?.participants
          .filter((participant) => participant.kind === "person")
          .flatMap((participant) => (participant.user_id ? [participant.user_id] : [])) ?? [],
      ),
    [activeConversation],
  );
  const directRecipient = useMemo(() => {
    if (!activeConversation || activeConversation.participants.length > 2) return undefined;
    const other = activeConversation.participants.find(
      (participant) =>
        participant.kind === "person" &&
        Boolean(participant.user_id) &&
        participant.user_id !== currentUserId,
    );
    return other?.user_id ? { userId: other.user_id, name: other.name } : undefined;
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
    agents: conversationId
      ? (store.agentsBySpace[spaceId] ?? emptyAgents).filter((agent) =>
          activeConversation?.participants.some(
            (participant) => participant.kind === "agent" && participant.agent_id === agent.id,
          ),
        )
      : (store.agentsBySpace[spaceId] ?? emptyAgents),
    members: conversationId
      ? allMembers.filter((member) => allowedMemberIds.has(member.user_id))
      : allMembers,
    messages: conversationId ? options.conversationMessages : defaultMessages,
  };
}
