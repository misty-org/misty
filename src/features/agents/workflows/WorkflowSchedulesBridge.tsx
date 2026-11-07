import { useAgentAccountId } from "../agentAccount";
import { useEffect } from "react";
import { startWaitingScheduledRuns } from "./deviceScheduledRuns";
import { useWorkflowSchedulesStore } from "./useWorkflowSchedulesStore";
import { observeWorkflowChanges } from "./workflowChanges";

/** How often this computer checks for scheduled runs due on it. */
const pickUpEveryMs = 60_000;

/**
 * Keeps workflow schedules current while the app is open: the list reloads whenever one
 * changes (and on stream reset). It also starts scheduled runs due on this computer, as
 * they come due and when the app opens after missing some.
 */
export function WorkflowSchedulesBridge() {
  const accountId = useAgentAccountId();

  useEffect(() => {
    useWorkflowSchedulesStore.getState().setAccount(accountId);
    if (!accountId) return;
    const pickUp = () => void startWaitingScheduledRuns(accountId).catch(() => {});
    pickUp();
    const timer = window.setInterval(pickUp, pickUpEveryMs);
    const stop = observeWorkflowChanges(accountId, async () => {
      pickUp();
      await useWorkflowSchedulesStore.getState().load();
    });
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [accountId]);

  return null;
}
