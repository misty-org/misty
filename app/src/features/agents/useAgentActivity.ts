import { agentsApi } from "@/api/agents/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonalAgentActivityPage,
  PersonalAgentRunDetail,
} from "./model/interfaces/personal";
import {
  cachedAgentActivity,
  cachedAgentRunDetail,
  loadAgentActivity,
  loadAgentRunDetail,
  setCachedAgentActivity,
} from "./agentActivityCache";
import type { PersonalAgentRunSummary } from "./model/interfaces/personal";

interface RetriedAgentRun {
  id: string;
  state?: PersonalAgentRunSummary["state"];
  created_at?: string;
  updated_at?: string;
}

export function activityWithOptimisticRetry(
  page: PersonalAgentActivityPage | null,
  retriedRunId: string,
  created: RetriedAgentRun,
): PersonalAgentActivityPage | null {
  if (!page || !created.id) return page;
  const previous = page.runs.find((run) => run.run_id === retriedRunId);
  if (!previous) return page;
  const now = new Date().toISOString();
  const replacement: PersonalAgentRunSummary = {
    ...previous,
    run_id: created.id,
    trigger_kind: "retry",
    state: created.state ?? "queued",
    phase: "queued",
    progress: 0,
    attempt: 1,
    error_code: undefined,
    error_message: undefined,
    response_message_id: undefined,
    approval_state: "none",
    created_at: created.created_at ?? now,
    updated_at: created.updated_at ?? now,
    completed_at: undefined,
  };
  return {
    ...page,
    work_state: "queued",
    queue_count: Math.max(1, page.queue_count + 1),
    active_run: replacement,
    runs: [replacement, ...page.runs],
  };
}

export function useAgentActivity(agentId: string) {
  const [activity, setActivity] = useState<PersonalAgentActivityPage | null>(
    cachedAgentActivity(agentId) ?? null,
  );
  const [runDetail, setRunDetail] = useState<PersonalAgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingRunId, setActingRunId] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);

  const refresh = useCallback(
    async (force = false) => {
      if (!agentId || document.visibilityState === "hidden") return;
      const current = ++generation.current;
      if (!cachedAgentActivity(agentId)) setLoading(true);
      try {
        const page = await loadAgentActivity(agentId, force);
        if (generation.current !== current) return;
        setActivity(page);
        setError("");
        const active = page.active_run;
        if (active && ["awaiting_approval", "awaiting_device"].includes(active.state)) {
          const detail = await loadAgentRunDetail(active.run_id, force);
          if (generation.current === current) setRunDetail(detail);
        } else if (!active) {
          setRunDetail(null);
        }
      } catch (reason) {
        if (generation.current === current)
          setError(
            reason instanceof Error ? reason.message : "Agent activity could not be loaded.",
          );
      } finally {
        if (generation.current === current) setLoading(false);
      }
    },
    [agentId],
  );

  const loadDetail = useCallback(async (runId: string) => {
    if (!runId) return;
    setError("");
    try {
      setRunDetail(await loadAgentRunDetail(runId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent details could not be loaded.");
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    setActivity(cachedAgentActivity(agentId) ?? null);
    const cachedRunId = cachedAgentActivity(agentId)?.active_run?.run_id ?? "";
    setRunDetail(cachedRunId ? (cachedAgentRunDetail(cachedRunId) ?? null) : null);
    setError("");
    if (!agentId) return;
    void refresh(false);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [agentId, refresh]);

  const active = activity?.runs.some((run) =>
    ["queued", "running", "awaiting_approval", "awaiting_device"].includes(run.state),
  );
  useEffect(() => {
    if (!agentId || !active) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [active, activity?.runs, agentId, refresh]);

  const act = useCallback(
    async (runId: string, action: "cancel" | "retry") => {
      setActingRunId(runId);
      setError("");
      try {
        if (action === "cancel") await agentsApi.cancelRun(runId);
        else {
          const created = await agentsApi.retryRun<RetriedAgentRun>(runId);
          setActivity((current) => {
            const optimistic = activityWithOptimisticRetry(current, runId, created);
            if (optimistic) setCachedAgentActivity(optimistic);
            return optimistic;
          });
        }
        void refresh(true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `Agent run could not be ${action}ed.`);
      } finally {
        setActingRunId("");
      }
    },
    [refresh],
  );

  const decideApproval = useCallback(
    async (runId: string, approvalId: string, decision: "approve" | "deny") => {
      setActingRunId(runId);
      setError("");
      try {
        await agentsApi.decideApproval(runId, approvalId, decision);
        await refresh(true);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "The approval decision could not be saved.",
        );
      } finally {
        setActingRunId("");
      }
    },
    [refresh],
  );

  return {
    activity,
    runDetail,
    loading,
    actingRunId,
    error,
    refresh,
    loadDetail,
    act,
    decideApproval,
  };
}
