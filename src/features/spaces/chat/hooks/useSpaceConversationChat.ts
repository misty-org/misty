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
    const updateAgentRun = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          space_id?: string;
          type?: string;
          entity_id?: string;
          payload?: Record<string, unknown>;
        }>
      ).detail;
      const payload = detail?.payload ?? {};
      if (detail?.space_id !== spaceId || payload.conversation_id !== conversationId) return;
      const messageId = String(payload.source_message_id ?? "");
      const triggerId = String(payload.trigger_id ?? detail.entity_id ?? "");
      if (!messageId || !triggerId || !detail.type?.startsWith("agent.run.")) return;
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId) return message;
          const run = {
            id: triggerId,
            agent_id: String(payload.agent_id ?? ""),
            state: detail.type!.slice("agent.run.".length) as NonNullable<
              SpaceMessage["triggered_runs"]
            >[number]["state"],
            run_id: String(payload.run_id ?? "") || undefined,
            error_code: String(payload.error_code ?? "") || undefined,
            error_message: String(payload.error_message ?? "") || undefined,
          };
          const runs = [...(message.triggered_runs ?? [])];
          const index = runs.findIndex((item) => item.id === triggerId);
          if (index >= 0) runs[index] = { ...runs[index], ...run };
          else runs.push(run);
          return { ...message, triggered_runs: runs };
        }),
      );
    };
    socialEvents.addEventListener("misty:space-message-event", reload);
    socialEvents.addEventListener("misty:space-agent-run-event", updateAgentRun);
    return () => {
      active = false;
      socialEvents.removeEventListener("misty:space-message-event", reload);
      socialEvents.removeEventListener("misty:space-agent-run-event", updateAgentRun);
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
