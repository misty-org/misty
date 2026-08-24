import type { AgentUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import { useEffect, useState } from "react";
import {
  fetchAgentUsage,
  getCachedAgentUsage,
  isAgentUsageStale,
  subscribeUsageCache,
  USAGE_CACHE_TTL_MS,
} from "../../store/usageCache";

/**
 * The account's weekly hosted-AI allowance.
 *
 * It is cached and rechecked every 5 minutes or when an Agent run finishes.
 */
export function useAgentUsage(ready: boolean): AgentUsage | null {
  const [usage, setUsage] = useState<AgentUsage | null>(() => getCachedAgentUsage());

  useEffect(() => {
    if (!ready) {
      return;
    }

    const unsubscribe = subscribeUsageCache(() => {
      setUsage(getCachedAgentUsage());
    });

    if (isAgentUsageStale()) {
      void fetchAgentUsage();
    } else {
      setUsage(getCachedAgentUsage());
    }

    const interval = setInterval(() => {
      void fetchAgentUsage(true);
    }, USAGE_CACHE_TTL_MS);

    const reloadWhenRunSettles = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type ?? "";
      if (
        type === "agent.run.completed" ||
        type === "agent.run.completed_with_errors" ||
        type === "agent.run.failed" ||
        type === "agent.run.canceled" ||
        type === "agent.run.rejected"
      ) {
        void fetchAgentUsage(true);
      }
    };

    window.addEventListener("misty:space-agent-run-event", reloadWhenRunSettles);
    return () => {
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("misty:space-agent-run-event", reloadWhenRunSettles);
    };
  }, [ready]);

  return usage;
}
