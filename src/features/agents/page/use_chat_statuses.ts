import { useEffect, useState } from "react";
import { runtimeAiApi } from "../agents_runtime";
import { useAgentAccountId } from "../personal/agent_account";
import { watchAllRunEvents } from "../runs/local-run/local_run_events";

export type ChatStatus = "working" | "needs-you" | "failed" | "done";

export function chatStatusOf(state: string): ChatStatus {
  if (state === "running" || state === "queued") return "working";
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  return state === "failed" ? "failed" : "done";
}

export function agoWords(value: string, now: number, verb?: string): string {
  const ago = shortAgo(value, now);
  if (!ago) return "";
  const words = ago === "now" ? "just now" : /^\d+[mhd]$/.test(ago) ? `${ago} ago` : `on ${ago}`;
  return verb ? `${verb} ${words}` : words;
}

export function shortAgo(value: string, now: number): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function useChatStatuses(): Record<string, ChatStatus> {
  const accountId = useAgentAccountId();
  const [statuses, setStatuses] = useState<Record<string, ChatStatus>>({});
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const refresh = () =>
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
