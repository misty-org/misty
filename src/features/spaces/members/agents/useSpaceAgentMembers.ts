import { agentMemberRequestsApi, type AgentListing } from "@/features/agent-member-requests/api";
import { useEffect, useState } from "react";

/** The agents that live in a Space, with whose each one is. */
export function useSpaceAgentMembers(spaceId: string) {
  const [agents, setAgents] = useState<AgentListing[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!spaceId) return;
    const controller = new AbortController();
    setError("");
    agentMemberRequestsApi
      .listings(spaceId, controller.signal)
      .then(({ listings }) => setAgents(listings))
      .catch(() => {
        if (controller.signal.aborted) return;
        setAgents((current) => current ?? []);
        setError("This Space’s agents couldn’t load.");
      });
    return () => controller.abort();
  }, [spaceId]);
  return { agents, error };
}

/** "Your agent", or whose agent it is. */
export function agentOwnerLabel(agent: AgentListing, currentUserId: string | undefined) {
  if (agent.owner_user_id === currentUserId) return "Your agent";
  const owner = agent.owner_name.trim().split(/\s+/)[0];
  return owner ? `${owner}’s agent` : "A member’s agent";
}

export function agentRequestPolicyLabel(agent: AgentListing) {
  if (agent.accept_policy === "auto") return "Takes requests";
  if (agent.accept_policy === "ask") return "Asks its owner first";
  return "Not taking requests";
}
