import { useEffect, useMemo, useRef } from "react";
import { spaceAgentsApi, useAgentAccountId, usePersonalAgentsStore } from "@/features/agents";
import type { SpaceMessage } from "../api/dto/entities";
import type { MentionableAgent } from "./useSpaceMessageSpansStore";

/**
 * The agents this person can @mention in a Space's chat: every one of their own that is on, since
 * any agent can work in any Space. Nobody else's agents are offered: a person runs only their own.
 */
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

/**
 * Before a message that mentions one of the person's agents is sent, brings that agent into the
 * Space, as the Space only takes mentions of agents it lists. The Space learns its name and nothing
 * else about it.
 */
export function useBringMentionedAgents(spaceId: string, agents: readonly MentionableAgent[]) {
  const brought = useRef(new Set<string>());
  return async (content: SpaceMessage["content"]) => {
    const mentioned = new Set(
      content.flatMap((span) =>
        span.type === "mention" && "agent_id" in span && span.agent_id ? [span.agent_id] : [],
      ),
    );
    for (const agent of agents) {
      const key = `${spaceId}:${agent.agent_id}`;
      if (!mentioned.has(agent.agent_id) || brought.current.has(key)) continue;
      await spaceAgentsApi.add(spaceId, agent.agent_id, agent.agent_name);
      brought.current.add(key);
    }
  };
}
