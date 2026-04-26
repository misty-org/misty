import { useCallback, useEffect, useState } from "react";
import type { SpaceMessageAgentRun } from "@/models/interfaces/features/spaces/types";

/** Run states where the Agent is still working on a reply. */
const IN_FLIGHT = new Set(["queued", "working", "retrying"]);

export interface PendingAgentRun {
  triggerId: string;
  runId: string;
  agentId: string;
}

/**
 * The Agent turns this conversation is still waiting on.
 *
 * This deliberately does not live on the messages. `triggered_runs` is only
 * populated on the send response — every subsequent read of the message list
 * omits it — so any refetch (and one fires on the member's own message.created)
 * wiped the in-flight state milliseconds after it appeared, and the typing
 * indicator never survived long enough to be seen. Keeping the pending turns in
 * their own state means only the run's own lifecycle events clear them.
 */
export function usePendingAgentRuns(spaceId: string, conversationId: string) {
  const [pending, setPending] = useState<PendingAgentRun[]>([]);

  useEffect(() => setPending([]), [conversationId, spaceId]);

  useEffect(() => {
    const onRunEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          space_id?: string;
          type?: string;
          entity_id?: string;
          payload?: Record<string, unknown>;
        }>
      ).detail;
      const payload = detail?.payload ?? {};
      if (detail?.space_id !== spaceId) return;
      if (String(payload.conversation_id ?? "") !== conversationId) return;
      if (!detail.type?.startsWith("agent.run.")) return;
      const state = detail.type.slice("agent.run.".length);
      const triggerId = String(payload.trigger_id ?? detail.entity_id ?? "");
      if (!triggerId) return;
      const runId = String(payload.run_id ?? "");
      const agentId = String(payload.agent_id ?? "");
      setPending((current) => {
        const rest = current.filter((item) => item.triggerId !== triggerId);
        if (!IN_FLIGHT.has(state)) return rest;
        // A later state carries the run id the queued event could not.
        const previous = current.find((item) => item.triggerId === triggerId);
        return [...rest, { triggerId, runId: runId || previous?.runId || "", agentId }];
      });
    };

    window.addEventListener("misty:space-agent-run-event", onRunEvent);
    return () => window.removeEventListener("misty:space-agent-run-event", onRunEvent);
  }, [conversationId, spaceId]);

  /**
   * Seeds the pending turn straight from the send response, so the indicator
   * appears on submit rather than after the queued event round-trips.
   */
  const track = useCallback((runs: SpaceMessageAgentRun[] | undefined) => {
    const queued = (runs ?? []).filter((run) => IN_FLIGHT.has(run.state));
    if (queued.length === 0) return;
    setPending((current) => [
      ...current.filter((item) => !queued.some((run) => run.id === item.triggerId)),
      ...queued.map((run) => ({
        triggerId: run.id,
        runId: run.run_id ?? "",
        agentId: run.agent_id,
      })),
    ]);
  }, []);

  return { pending, track };
}
