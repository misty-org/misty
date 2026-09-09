import { socialEvents } from "../socialRuntime";
import { socialApi as spacesApi } from "@/features/spaces/chat/socialRuntime";
import type {
  SpaceConversation,
  SpaceEvent,
  SpaceMessage,
} from "@/api/spaces/dto/interfaces/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeSpaceMessages, messageFromSpaceEvent } from "../store/useSpaceMessageSpansStore";

export function useSpaceConversationChat(
  spaceId: string,
  conversationId: string,
  canRead: boolean,
  loadConversationsWithoutSelection = false,
) {
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [loadedConversationId, setLoadedConversationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const activeConversationIdRef = useRef("");
  const reloadMessages = useCallback(() => setReloadRevision((current) => current + 1), []);
  useEffect(() => {
    if (!canRead || (!conversationId && !loadConversationsWithoutSelection)) {
      setConversations([]);
      setMessages([]);
      setLoadedConversationId("");
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    if (activeConversationIdRef.current !== conversationId) {
      activeConversationIdRef.current = conversationId;
      setMessages([]);
    }
    setLoadedConversationId("");
    const request = conversationId
      ? Promise.all([
          spacesApi.conversations(spaceId),
          spacesApi.conversationMessages(spaceId, conversationId),
        ])
      : Promise.all([spacesApi.conversations(spaceId), Promise.resolve({ messages: [] })]);
    void request
      .then(([conversationResult, messageResult]) => {
        if (!active) return;
        setConversations(conversationResult.conversations);
        const ordered = [...messageResult.messages].reverse();
        setMessages((current) =>
          mergeSpaceMessages(
            current.filter((message) => Boolean(message.local_delivery_state)),
            ordered,
          ),
        );
        if (conversationId) setLoadedConversationId(conversationId);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "This group chat could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const reload = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          event?: SpaceEvent;
        }>
      ).detail;
      if (detail?.spaceId !== spaceId || detail.conversationId !== conversationId) return;
      const includedMessage = detail.event ? messageFromSpaceEvent(detail.event) : undefined;
      if (includedMessage) {
        setMessages((current) => mergeSpaceMessages(current, [includedMessage]));
        return;
      }
      void spacesApi
        .conversationMessages(spaceId, conversationId)
        .then(({ messages: next }) => {
          if (!active) return;
          setMessages((current) =>
            mergeSpaceMessages(
              current.filter((message) => Boolean(message.local_delivery_state)),
              [...next].reverse(),
            ),
          );
          setError("");
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "This group chat could not be loaded.",
            );
        });
    };
    socialEvents.addEventListener("misty:space-message-event", reload);
    return () => {
      active = false;
      socialEvents.removeEventListener("misty:space-message-event", reload);
    };
  }, [canRead, conversationId, loadConversationsWithoutSelection, reloadRevision, spaceId]);
  return {
    conversations,
    messages,
    setMessages,
    loadedConversationId,
    loading,
    error,
    setError,
    reload: reloadMessages,
  };
}
