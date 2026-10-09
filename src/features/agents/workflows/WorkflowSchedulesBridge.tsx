import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { useEffect } from "react";
import { useWorkflowSchedulesStore } from "./useWorkflowSchedulesStore";

/**
 * Keeps workflow schedules current while the app is open. The server publishes a
 * "workflows" account event whenever a schedule changes, so the list reloads on
 * change (and on stream reset).
 */
export function WorkflowSchedulesBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";

  useEffect(() => {
    useWorkflowSchedulesStore.getState().setAccount(accountId);
    if (!accountId) return;
    return observeAccountChanges(accountId, ["workflows"], () =>
      useWorkflowSchedulesStore.getState().load(),
    );
  }, [accountId]);

  return null;
}
