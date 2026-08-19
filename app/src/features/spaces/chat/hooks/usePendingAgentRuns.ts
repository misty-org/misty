import type { SpaceMessageAgentRun } from "@/api/spaces/dto/interfaces/types";
import { useCallback, useEffect, useRef, useState } from "react";

/** Run states where the Agent is still working on a reply. */
const IN_FLIGHT = new Set(["queued", "working", "retrying"]);

// A human doesn't answer the instant they're @mentioned — a beat before the
// typing bubble appears reads as "noticed the message" rather than "a script
// fired". If the real reply lands before this elapses, the bubble never
// shows at all, so a fast Agent still feels just as fast.
const TYPING_INDICATOR_DELAY_MS = 900;

export interface PendingAgentRun {
  triggerId: string;
  runId: string;
  agentId: string;
}

/**
 * The Agent turns this conversation is still waiting on.
 *
 * This deliberately does not live on the messages. `triggered_runs` is only
 * populated on the send response but omitted from ordinary message snapshots.
 * Keeping pending turns in their own state means a later snapshot or realtime
 * merge cannot erase the typing indicator; only run lifecycle events clear it.
 *
 * Becoming in-flight and becoming *visible* are separate: a short delay sits
 * between them so the typing bubble reads as a beat of attention rather than
 * an instant, mechanical pop-in. A run that finishes inside that window never
 * shows a bubble at all — the reply just appears.
 */
export function usePendingAgentRuns(spaceId: string, conversationId: string) {
  const [pending, setPending] = useState<PendingAgentRun[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastRunIdRef = useRef(new Map<string, string>());

  const clearTimer = (triggerId: string) => {
    const timer = timersRef.current.get(triggerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(triggerId);
    }
  };

  const hide = useCallback((triggerId: string) => {
    clearTimer(triggerId);
    lastRunIdRef.current.delete(triggerId);
    setPending((current) => current.filter((item) => item.triggerId !== triggerId));
  }, []);

  const showAfterDelay = useCallback((run: PendingAgentRun) => {
    if (run.runId) lastRunIdRef.current.set(run.triggerId, run.runId);
    clearTimer(run.triggerId);
    const timer = setTimeout(() => {
      timersRef.current.delete(run.triggerId);
      const runId = run.runId || lastRunIdRef.current.get(run.triggerId) || "";
      setPending((current) => [
        ...current.filter((item) => item.triggerId !== run.triggerId),
        { ...run, runId },
      ]);
    }, TYPING_INDICATOR_DELAY_MS);
    timersRef.current.set(run.triggerId, timer);
  }, []);

  useEffect(() => {
    setPending([]);
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    lastRunIdRef.current.clear();
  }, [conversationId, spaceId]);

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
      if (!IN_FLIGHT.has(state)) {
        hide(triggerId);
        return;
      }
      const runId = String(payload.run_id ?? "");
      const agentId = String(payload.agent_id ?? "");
      showAfterDelay({ triggerId, runId, agentId });
    };

    window.addEventListener("misty:space-agent-run-event", onRunEvent);
    return () => window.removeEventListener("misty:space-agent-run-event", onRunEvent);
  }, [conversationId, spaceId, hide, showAfterDelay]);

  /**
   * Seeds the pending turn straight from the send response, so the delay
   * timer starts on submit rather than after the queued event round-trips.
   */
  const track = useCallback(
    (runs: SpaceMessageAgentRun[] | undefined) => {
      const queued = (runs ?? []).filter((run) => IN_FLIGHT.has(run.state));
      for (const run of queued) {
        showAfterDelay({ triggerId: run.id, runId: run.run_id ?? "", agentId: run.agent_id });
      }
    },
    [showAfterDelay],
  );

  return { pending, track };
}
