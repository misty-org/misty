import { useEffect, useMemo, useRef } from "react";
import { useAgentAccountId, usePersonalAgentsStore } from "@/features/agents";
import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import type { MentionableAgent } from "./use_space_message_spans_store";

export function useOwnMentionableAgents(
  userId: string | undefined,
  spaceId?: string,
): MentionableAgent[] {
  const accountId = useAgentAccountId();
  const agents = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    if (accountId && !usePersonalAgentsStore.getState().agents.length)
      void usePersonalAgentsStore.getState().load(accountId);
  }, [accountId]);
  return useMemo(
    () =>
      userId
        ? agents
            .filter((agent) => agent.enabled && (!spaceId || agent.space_id === spaceId))
            .map((agent) => ({
              agent_id: agent.id,
              agent_name: agent.name,
              owner_user_id: userId,
            }))
        : [],
    [agents, userId, spaceId],
  );
}

export function useBringMentionedAgents(
  spaceId: string,
  agents: readonly MentionableAgent[],
  groupConversationId = "",
) {
  const brought = useRef(new Set<string>());
  return async (content: SpaceMessage["content"]) => {
    const mentioned = new Set(
      content.flatMap((span) =>
        span.type === "mention" && "agent_id" in span && span.agent_id ? [span.agent_id] : [],
      ),
    );
    if (!groupConversationId) return;
    for (const agent of agents) {
      const key = `${spaceId}:${groupConversationId}:${agent.agent_id}`;
      if (!mentioned.has(agent.agent_id) || brought.current.has(key)) continue;
      await spacesApi.addConversationAgent(
        spaceId,
        groupConversationId,
        agent.agent_id,
        agent.agent_name,
      );
      brought.current.add(key);
    }
  };
}
