import { useEffect, useState } from "react";
import { Check, CircleAlert, Clock, LoaderCircle, X } from "lucide-react";
import { observeAccountChanges } from "@/api/accountEvents";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { runtimeAiApi } from "../AgentsRuntime";

/** One agent's account activity, refreshed whenever runs or invocations change. */
export function useAgentActivity(accountId: string, agentId?: string) {
  const [state, setState] = useState<{
    key: string;
    entries: MistyActivityEntry[];
    loading: boolean;
    failed: boolean;
  }>({ key: "", entries: [], loading: true, failed: false });
  const key = `${accountId}:${agentId ?? ""}`;
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    const refresh = async () => {
      try {
        const result = await runtimeAiApi.activity("", agentId);
        if (live) setState({ key, entries: result.entries, loading: false, failed: false });
      } catch {
        if (live)
          setState((s) => ({
            key,
            entries: s.key === key ? s.entries : [],
            loading: false,
            failed: true,
          }));
      }
    };
    const stop = observeAccountChanges(accountId, ["runs", "invocations"], refresh);
    return () => {
      live = false;
      stop();
    };
  }, [accountId, agentId, key]);
  return state.key === key
    ? state
    : { key, entries: [], loading: Boolean(accountId), failed: false };
}

export const activityStateLabels: Record<string, string> = {
  queued: "Queued",
  running: "Working",
  completed: "Done",
  failed: "Failed",
  canceled: "Canceled",
  completed_with_errors: "Done with errors",
  awaiting_approval: "Needs approval",
  awaiting_device: "Waiting for device",
  awaiting_intervention: "Needs attention",
};

export const formatActivityTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? `Today, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const activityStateIcon = (state: string) =>
  state === "completed"
    ? Check
    : state === "running"
      ? LoaderCircle
      : state === "queued" || state === "awaiting_device"
        ? Clock
        : state === "canceled"
          ? X
          : CircleAlert;
