import { useEffect, useState } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { AgentUsage } from "@/models/interfaces/features/spaces/agentUsageTypes";

/**
 * The account's weekly hosted-AI allowance.
 *
 * It is per account rather than per Space, so it loads once the panel is ready
 * and refreshes when an Agent run finishes — the only thing that spends it.
 * A failed load leaves the row hidden rather than showing a scary zero.
 */
export function useAgentUsage(ready: boolean): AgentUsage | null {
  const [usage, setUsage] = useState<AgentUsage | null>(null);

  useEffect(() => {
    if (!ready) {
      setUsage(null);
      return;
    }
    let active = true;
    const load = () => {
      void spacesApi
        .agentUsage()
        .then((result) => {
          if (active) setUsage(result.agent_usage ?? null);
        })
        .catch(() => {
          if (active) setUsage(null);
        });
    };
    const reloadWhenRunSettles = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type ?? "";
      if (
        type === "agent.run.completed" ||
        type === "agent.run.completed_with_errors" ||
        type === "agent.run.failed" ||
        type === "agent.run.canceled" ||
        type === "agent.run.rejected"
      )
        load();
    };
    load();
    window.addEventListener("misty:space-agent-run-event", reloadWhenRunSettles);
    return () => {
      active = false;
      window.removeEventListener("misty:space-agent-run-event", reloadWhenRunSettles);
    };
  }, [ready]);

  return usage;
}
