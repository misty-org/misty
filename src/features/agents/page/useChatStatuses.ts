import { useEffect, useState } from "react";
import { runtimeAiApi } from "../AgentsRuntime";
import { useAgentAccountId } from "../personal/agentAccount";
import { watchAllRunEvents } from "../runs/local-run/localRunEvents";

/** What a chat's latest run is doing, for its row in the sidebar. */
export type ChatStatus = "working" | "needs-you" | "failed" | "done";

export function chatStatusOf(state: string): ChatStatus {
  if (state === "running" || state === "queued") return "working";
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  return state === "failed" ? "failed" : "done";
}

/** A short "how long ago" for a row with little room: now, 5m, 2h, 3d, then a date. */
export function shortAgo(value: string, now = Date.now()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Each chat's latest top-level run, kept current as runs report. */
export function useChatStatuses(): Record<string, ChatStatus> {
  const accountId = useAgentAccountId();
  const [statuses, setStatuses] = useState<Record<string, ChatStatus>>({});
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const refresh = () =>
      // Before the agents' services are mounted there is nothing to ask yet.
      void Promise.resolve()
        .then(() => runtimeAiApi.activity(""))
        .then((result) => {
          if (!live) return;
          const newest = new Map<string, { at: string; state: string }>();
          for (const entry of result.entries) {
            if (entry.parent_run_id || !entry.conversation_id) continue;
            const known = newest.get(entry.conversation_id);
            if (!known || entry.updated_at > known.at)
              newest.set(entry.conversation_id, { at: entry.updated_at, state: entry.state });
          }
          setStatuses(
            Object.fromEntries([...newest].map(([id, run]) => [id, chatStatusOf(run.state)])),
          );
        })
        .catch(() => undefined);
    refresh();
    const stop = watchAllRunEvents(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 500);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [accountId]);
  return statuses;
}
