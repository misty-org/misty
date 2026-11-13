import { useEffect, useState } from "react";
import type { MistyActivityEntry } from "../conversations/state/activity";
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
    void refresh();
    return () => {
      live = false;
    };
  }, [accountId, agentId, key]);
  return state.key === key
    ? state
    : { key, entries: [], loading: Boolean(accountId), failed: false };
}
