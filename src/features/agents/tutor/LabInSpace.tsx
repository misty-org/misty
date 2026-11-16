import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AgentProfile } from "@/shared/schemas";
import { useAgentAccountId } from "../personal/agentAccount";
import { homeSpaceOf } from "../personal/agentHomeSpace";
import { useMistyStore } from "../conversations/state/useMistyStore";

/**
 * The Lab is a page of a Space, so an agent's Lab tab goes to its home Space's Lab, keeping which
 * notebook was asked for. The agent is chosen first, so that Lab's runs go to it.
 */
export function LabInSpace({ agent }: { agent: AgentProfile }) {
  const navigate = useNavigate();
  const location = useLocation();
  const accountId = useAgentAccountId();
  const spaceId = homeSpaceOf(accountId, agent);
  useEffect(() => {
    // Until the account's Spaces load, the agent's home isn't known yet.
    if (!spaceId) return;
    useMistyStore.setState({ selectedAgentId: agent.id });
    const params = new URLSearchParams(location.search);
    const kept = new URLSearchParams();
    for (const key of ["item", "doc"]) {
      const value = params.get(key);
      if (value) kept.set(key, value);
    }
    const query = kept.toString();
    navigate(`/spaces/${encodeURIComponent(spaceId)}/lab${query ? `?${query}` : ""}`, {
      replace: true,
    });
  }, [spaceId, agent.id, location.search, navigate]);
  return null;
}
