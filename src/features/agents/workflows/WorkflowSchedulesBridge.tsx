import { observeAccountChanges } from "@/api/accountEvents";
import { useActivityStore } from "@/features/activity/useActivityStore";
import { useAuth } from "@/features/auth";
import { useEffect, useRef } from "react";
import { useWorkflowSchedulesStore } from "./useWorkflowSchedulesStore";

/**
 * Keeps workflow schedules current while the app is open and posts each finished
 * scheduled run to Activity. Runs that finished before this session started are
 * history, not news. The server publishes a "workflows" account event whenever a
 * schedule changes, so the list reloads on change (and on stream reset).
 */
export function WorkflowSchedulesBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const seenRuns = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    useWorkflowSchedulesStore.getState().setAccount(accountId);
    seenRuns.current = null;
    if (!accountId) return;
    return observeAccountChanges(accountId, ["workflows"], () =>
      useWorkflowSchedulesStore.getState().load(),
    );
  }, [accountId]);

  useEffect(
    () =>
      useWorkflowSchedulesStore.subscribe((state, previous) => {
        if (state.runs === previous.runs || state.state !== "ready") return;
        const firstLoad = seenRuns.current === null;
        const seen = seenRuns.current ?? new Map<string, string>();
        seenRuns.current = seen;
        for (const run of state.runs) {
          const lastRun = run.last_run_at ?? "";
          const known = seen.get(run.id);
          seen.set(run.id, lastRun);
          if (firstLoad || !lastRun || known === lastRun || run.state === "running") continue;
          const failed = run.state === "failed";
          useActivityStore.getState().ingestLocal({
            id: `workflow-schedule:${run.id}:${lastRun}`,
            accountId: state.accountId,
            kind: failed ? "failure" : "completion",
            sourceLabel: "Scheduled workflow",
            title: failed ? `${run.title} didn’t finish` : `${run.title} ran`,
            body: failed
              ? run.last_error || "Open the workflow to see what happened."
              : "Open the conversation to see what Misty found.",
            attention: failed,
            target: { kind: "route", href: "/agents?view=workflows" },
          });
        }
      }),
    [],
  );

  return null;
}
