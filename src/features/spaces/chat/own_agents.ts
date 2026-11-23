import { useEffect, useMemo, useRef } from "react";
import { spaceAgentsApi, useAgentAccountId, usePersonalAgentsStore } from "@/features/agents";
import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import type { MentionableAgent } from "./use_space_message_spans_store";

export function useOwnMentionableAgents(userId: string | undefined): MentionableAgent[] {
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
            .filter((agent) => agent.enabled)
            .map((agent) => ({
              agent_id: agent.id,
              agent_name: agent.name,
              owner_user_id: userId,
            }))
        : [],
    [agents, userId],
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
    for (const agent of agents) {
      const key = `${spaceId}:${groupConversationId}:${agent.agent_id}`;
      if (!mentioned.has(agent.agent_id) || brought.current.has(key)) continue;
      if (groupConversationId)
        await spacesApi.addConversationAgent(
          spaceId,
          groupConversationId,
          agent.agent_id,
          agent.agent_name,
        );
      else await spaceAgentsApi.add(spaceId, agent.agent_id, agent.agent_name);
      brought.current.add(key);
    }
  };
}
