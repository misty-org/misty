import { useSpacesStore } from "../../list/use_spaces_store";
import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
} from "../../api/dto/entities";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];

export function useSpaceChatStore() {
  return useSpacesStore(
    useShallow((state) => ({
      messagesBySpace: state.messagesBySpace,
      messageLoadingBySpace: state.messageLoadingBySpace,
      messageErrorsBySpace: state.messageErrorsBySpace,
      messageHistoryBySpace: state.messageHistoryBySpace,
      membersBySpace: state.membersBySpace,
      nodesBySpace: state.nodesBySpace,
      loading: state.loading,
      sending: state.sending,
      referenceOnly: state.referenceOnly,
      sendMessage: state.sendMessage,
      updateMessage: state.updateMessage,
      deleteMessage: state.deleteMessage,
      toggleMessageReaction: state.toggleMessageReaction,
      markRead: state.markRead,
      loadMessages: state.loadMessages,
      loadOlderMessages: state.loadOlderMessages,
      openNode: state.openNode,
      clearSpacesError: state.clearError,
    })),
  );
}

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
    if (
      activeConversation?.kind !== "dm" ||
      activeConversation.participants.filter((participant) => participant.kind === "person")
        .length > 2
    )
      return undefined;
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

  const members = useMemo(
    () =>
      conversationId
        ? allMembers.filter((member) => allowedMemberIds.has(member.user_id))
        : allMembers,
    [allMembers, allowedMemberIds, conversationId],
  );

  return {
    allMembers,
    defaultMessages,
    activeConversation,
    directRecipient,
    nodes,
    members,
    messages: conversationId ? options.conversationMessages : defaultMessages,
  };
}
