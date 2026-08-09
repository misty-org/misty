import { useEffect, useState } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";

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
    setMessages([]);
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
        setMessages([...messageResult.messages].reverse());
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
      const detail = (event as CustomEvent<{ spaceId?: string; conversationId?: string }>).detail;
      if (detail?.spaceId !== spaceId || detail.conversationId !== conversationId) return;
      void spacesApi.conversationMessages(spaceId, conversationId).then(({ messages: next }) => {
        if (active) setMessages([...next].reverse());
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
    window.addEventListener("misty:space-message-event", reload);
    window.addEventListener("misty:space-agent-run-event", updateAgentRun);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", reload);
      window.removeEventListener("misty:space-agent-run-event", updateAgentRun);
    };
  }, [canRead, conversationId, loadConversationsWithoutSelection, spaceId]);
  return {
    conversations,
    messages,
    setMessages,
    loadedConversationId,
    loading,
    error,
    setError,
  };
}
