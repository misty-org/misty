import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { useEffect } from "react";
import { startWaitingScheduledRuns } from "./deviceScheduledRuns";
import { useWorkflowSchedulesStore } from "./useWorkflowSchedulesStore";

/** How often this computer checks for scheduled runs waiting for it. */
const pickUpEveryMs = 60_000;

/**
 * Keeps workflow schedules current while the app is open. The server publishes a
 * "workflows" account event whenever a schedule changes, so the list reloads on
 * change (and on stream reset). It also starts scheduled runs that wait for
 * this computer's Misty browser (roadmap C1), as they come due and when the
 * app opens after missing some.
 */
export function WorkflowSchedulesBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";

  useEffect(() => {
    useWorkflowSchedulesStore.getState().setAccount(accountId);
    if (!accountId) return;
    const pickUp = () => void startWaitingScheduledRuns(accountId).catch(() => {});
    pickUp();
    const timer = window.setInterval(pickUp, pickUpEveryMs);
    const stop = observeAccountChanges(accountId, ["workflows"], async () => {
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
