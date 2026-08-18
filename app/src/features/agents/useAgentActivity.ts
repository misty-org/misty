import { agentsApi } from "@/api/agents/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonalAgentActivityPage,
  PersonalAgentRunDetail,
} from "./model/interfaces/personal";

export function useAgentActivity(agentId: string) {
  const [activity, setActivity] = useState<PersonalAgentActivityPage | null>(null);
  const [runDetail, setRunDetail] = useState<PersonalAgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingRunId, setActingRunId] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!agentId || document.visibilityState === "hidden") return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const page = await agentsApi.activity<PersonalAgentActivityPage>(agentId);
      if (generation.current !== current) return;
      setActivity(page);
      setError("");
      const runId = page.active_run?.run_id ?? page.runs[0]?.run_id;
      if (runId) {
        const detail = await agentsApi.run<PersonalAgentRunDetail>(runId);
        if (generation.current === current) setRunDetail(detail);
      } else {
        setRunDetail(null);
      }
    } catch (reason) {
      if (generation.current === current)
        setError(reason instanceof Error ? reason.message : "Agent activity could not be loaded.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    generation.current += 1;
    setActivity(null);
    setRunDetail(null);
    setError("");
    if (!agentId) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [agentId, refresh]);

  const act = useCallback(
    async (runId: string, action: "cancel" | "retry") => {
      setActingRunId(runId);
      setError("");
      try {
        if (action === "cancel") await agentsApi.cancelRun(runId);
        else await agentsApi.retryRun(runId);
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `Agent run could not be ${action}ed.`);
      } finally {
        setActingRunId("");
      }
    },
    [refresh],
  );

  return { activity, runDetail, loading, actingRunId, error, refresh, act };
}
