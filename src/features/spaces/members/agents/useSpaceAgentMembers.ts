import { spaceAgentsApi, type SpaceAgent } from "@/api/spaces/space-agents";
import { useCallback, useEffect, useState } from "react";

/** The agents in a Space, each under the person who owns it. */
export function useSpaceAgentMembers(spaceId: string) {
  const [agents, setAgents] = useState<SpaceAgent[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!spaceId) return;
    const controller = new AbortController();
    setError("");
    spaceAgentsApi
      .list(spaceId, controller.signal)
      .then((result) => setAgents(result.agents))
      .catch(() => {
        if (controller.signal.aborted) return;
        setAgents((current) => current ?? []);
        setError("This Space’s agents couldn’t load.");
      });
    return () => controller.abort();
  }, [spaceId, revision]);
  const change = useCallback(async (work: () => Promise<unknown>, failure: string) => {
    setError("");
    try {
      await work();
      setRevision((value) => value + 1);
    } catch {
      setError(failure);
    }
  }, []);
  return {
    agents,
    error,
    /** Brings one of your agents into this Space. */
    bring: (agentId: string) =>
      change(() => spaceAgentsApi.add(spaceId, agentId), "That agent couldn’t be added."),
    /** Takes an agent out; its owner or the Space's owner may. */
    remove: (agentId: string) =>
      change(() => spaceAgentsApi.remove(spaceId, agentId), "That agent couldn’t be removed."),
  };
}

/** "Your agent", or whose agent it is. */
export function agentOwnerLabel(agent: SpaceAgent, currentUserId: string | undefined) {
  if (agent.owner_user_id === currentUserId) return "Your agent";
  const owner = agent.owner_name.trim().split(/\s+/)[0];
  return owner ? `${owner}’s agent` : "A member’s agent";
}

/** The agents each person brought, keyed by their user id. */
export function agentsByOwner(agents: SpaceAgent[] | undefined) {
  const byOwner = new Map<string, SpaceAgent[]>();
  for (const agent of agents ?? []) {
    byOwner.set(agent.owner_user_id, [...(byOwner.get(agent.owner_user_id) ?? []), agent]);
  }
  return byOwner;
}
