import { spaceAgentsApi, type SpaceAgent } from "@/features/agents";
import { usePersonalAgentsStore } from "@/features/agents";
import { setItemVisibility, type ItemVisibility } from "../../api/visibility";
import { useCallback, useEffect, useState } from "react";

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
    bring: (agentId: string) =>
      change(() => {
        const mine = usePersonalAgentsStore.getState().agents.find((agent) => agent.id === agentId);
        return spaceAgentsApi.add(spaceId, agentId, mine?.name ?? "");
      }, "That agent couldn’t be added."),
    remove: (agentId: string) =>
      change(() => spaceAgentsApi.remove(spaceId, agentId), "That agent couldn’t be removed."),
    setVisibility: (agentId: string, visibility: ItemVisibility) =>
      change(
        () => setItemVisibility(spaceId, "agent", agentId, visibility),
        `That agent couldn’t be made ${visibility}.`,
      ),
  };
}

export function agentOwnerLabel(agent: SpaceAgent, currentUserId: string | undefined) {
  if (agent.owner_user_id === currentUserId) return "your agent";
  const owner = agent.owner_name.trim().split(/\s+/)[0];
  return owner ? `${owner}’s agent` : "a member’s agent";
}

export function agentsByOwner(agents: SpaceAgent[] | undefined) {
  const byOwner = new Map<string, SpaceAgent[]>();
  for (const agent of agents ?? []) {
    byOwner.set(agent.owner_user_id, [...(byOwner.get(agent.owner_user_id) ?? []), agent]);
  }
  return byOwner;
}
