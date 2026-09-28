import { useActivityStore } from "@/features/activity/useActivityStore";
import { useAuth } from "@/features/auth";
import { useEffect, useRef } from "react";
import { useScheduledTasksStore } from "./useScheduledTasksStore";

const refreshMs = 60_000;

/**
 * Keeps scheduled tasks current while the app is open and posts each finished run to
 * Activity. Runs that finished before this session started are history, not news.
 */
export function ScheduledTasksBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const seenRuns = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const store = useScheduledTasksStore.getState();
    store.setAccount(accountId);
    seenRuns.current = null;
    if (!accountId) return;
    const refresh = () => void useScheduledTasksStore.getState().load();
    refresh();
    const interval = window.setInterval(refresh, refreshMs);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [accountId]);

  useEffect(
    () =>
      useScheduledTasksStore.subscribe((state, previous) => {
        if (state.tasks === previous.tasks || state.state !== "ready") return;
        const firstLoad = seenRuns.current === null;
        const seen = seenRuns.current ?? new Map<string, string>();
        seenRuns.current = seen;
        for (const task of state.tasks) {
          const lastRun = task.last_run_at ?? "";
          const known = seen.get(task.id);
          seen.set(task.id, lastRun);
          if (firstLoad || !lastRun || known === lastRun || task.state === "running") continue;
          const failed = task.state === "failed";
          useActivityStore.getState().ingestLocal({
            id: `scheduled-task:${task.id}:${lastRun}`,
            accountId: state.accountId,
            kind: failed ? "failure" : "completion",
            sourceLabel: "Scheduled",
            title: failed ? `${task.title} didn’t finish` : `${task.title} ran`,
            body: failed
              ? task.last_error || "Open the task to see what happened."
              : "Open the conversation to see what Misty found.",
            attention: failed,
            target: {
              kind: "route",
              href: `/scheduled?task=${encodeURIComponent(task.id)}`,
            },
          });
        }
      }),
    [],
  );

  return null;
}
