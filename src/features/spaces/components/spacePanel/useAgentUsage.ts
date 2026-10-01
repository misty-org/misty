import { subscribeAccountEvents } from "@/api/accountEvents";
import type { AgentUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import { useAuth } from "@/features/auth";
import { useEffect, useState } from "react";
import {
  fetchAgentUsage,
  getCachedAgentUsage,
  isAgentUsageStale,
  subscribeUsageCache,
} from "../../store/usageCache";

/**
 * The account's weekly hosted-AI allowance.
 *
 * It is cached and rechecked when an Agent run finishes here, or when the server
 * reports a billed transition from any device ("usage" account event).
 */
export function useAgentUsage(ready: boolean): AgentUsage | null {
  const [usage, setUsage] = useState<AgentUsage | null>(() => getCachedAgentUsage());
  const accountId = useAuth().user?.id ?? "";

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

    const stopEvents = subscribeAccountEvents(accountId, (event) => {
      if (event.topic === "usage" || event.topic === "reset") void fetchAgentUsage(true);
    });

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
      stopEvents();
      window.removeEventListener("misty:space-agent-run-event", reloadWhenRunSettles);
    };
  }, [accountId, ready]);

  return usage;
}
