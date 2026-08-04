import { useEffect, useState } from "react";
import { analytics } from "@/analytics/client";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import { personalAgentsApi } from "@/stores/agents/usePersonalAgentsStore";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  AgentToolboxAction,
  SpaceRun,
  SpaceRunDetail,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";

interface AgentDockDetailsOptions {
  spaceId?: string;
  surface: "files" | "space";
  agentId: string;
  coordinator: boolean;
  canLoadPersonalToolbox: boolean;
  loadMembers: (spaceId: string) => Promise<void>;
}

export function useAgentDockDetails({
  spaceId,
  surface,
  agentId,
  coordinator,
  canLoadPersonalToolbox,
  loadMembers,
}: AgentDockDetailsOptions) {
  const [runs, setRuns] = useState<SpaceRun[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, SpaceRunDetail>>({});
  const [toolbox, setToolbox] = useState<AgentToolboxAction[]>([]);
  const [availableContext, setAvailableContext] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingRunId, setActingRunId] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let current = true;
    let pollHandle: number | undefined;
    let loadRunsInFlight: Promise<void> | null = null;
    let lastMembershipRefreshSignature = "";
    const detailVersions = new Map<string, string>();
    setRuns([]);
    setRunDetails({});
    setToolbox([]);
    setAvailableContext([]);
    if (!agentId) return;
    setLoading(true);
    const requests: Array<Promise<unknown>> = [];

    if (spaceId) {
      if (!coordinator) {
        const loadRuns = async () => {
          if (loadRunsInFlight) return loadRunsInFlight;
          const task = refreshRuns();
          loadRunsInFlight = task;
          try {
            await task;
          } finally {
            if (loadRunsInFlight === task) loadRunsInFlight = null;
          }
        };
        const refreshRuns = async () => {
          const response = await agentArchitectureApi.runs(spaceId, agentId);
          if (!current) return;
          setRuns(response.runs);
          const visibleRuns = response.runs.slice(0, 12);
          const changedRuns = visibleRuns.filter(
            (run) => detailVersions.get(run.id) !== run.updated_at,
          );
          const details = await Promise.allSettled(
            changedRuns.map((run) => agentArchitectureApi.runDetail(run.id)),
          );
          if (!current) return;
          applyRunDetails(details, detailVersions, setRunDetails);
          const signature = visibleRuns
            .map((run) => `${run.id}:${run.state}:${run.updated_at}`)
            .join("|");
          if (signature !== lastMembershipRefreshSignature) {
            lastMembershipRefreshSignature = signature;
            await loadMembers(spaceId).catch(() => undefined);
          }
        };
        requests.push(loadRuns());
        pollHandle = window.setInterval(() => void loadRuns().catch(() => undefined), 6000);
      }
      requests.push(
        spacesApi.spaceAgentToolbox(spaceId, agentId).then((response) => {
          if (!current) return;
          setToolbox(response.actions);
          setAvailableContext(response.context ?? []);
          trackCapabilityDenials(surface, response.actions);
        }),
      );
    } else if (canLoadPersonalToolbox) {
      requests.push(
        personalAgentsApi
          .toolbox(agentId)
          .then((response) => current && setToolbox(response.actions)),
      );
    }
    void Promise.allSettled(requests).finally(() => current && setLoading(false));
    return () => {
      current = false;
      if (pollHandle !== undefined) window.clearInterval(pollHandle);
    };
  }, [agentId, canLoadPersonalToolbox, coordinator, loadMembers, spaceId, surface]);

  useEffect(() => {
    const attentionRun = runs.find((run) =>
      ["completed", "awaiting_approval", "failed", "completed_with_errors"].includes(run.state),
    );
    if (!attentionRun) return;
    analytics.track("agent_work_outcome_observed", {
      outcome:
        attentionRun.state === "awaiting_approval"
          ? "needs_approval"
          : attentionRun.state === "completed"
            ? "completed"
            : "failed",
      source_type: attentionRun.source_type,
    });
  }, [runs]);

  const refreshRun = async (runId: string, nextRun: SpaceRun) => {
    setRuns((current) => current.map((run) => (run.id === runId ? nextRun : run)));
    const detail = await agentArchitectureApi.runDetail(nextRun.id);
    setRunDetails((current) => ({ ...current, [detail.run.id]: detail }));
    if (spaceId) await loadMembers(spaceId).catch(() => undefined);
  };
  const runAction = async (runId: string, action: () => Promise<SpaceRun>) => {
    setActingRunId(runId);
    setActionError("");
    try {
      await refreshRun(runId, await action());
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The Agent action could not be completed.",
      );
    } finally {
      setActingRunId("");
    }
  };

  return {
    runs,
    runDetails,
    toolbox,
    availableContext,
    loading,
    actingRunId,
    actionError,
    runAction,
  };
}

function applyRunDetails(
  details: PromiseSettledResult<SpaceRunDetail>[],
  versions: Map<string, string>,
  setDetails: React.Dispatch<React.SetStateAction<Record<string, SpaceRunDetail>>>,
) {
  const fulfilled = details.filter(
    (detail): detail is PromiseFulfilledResult<SpaceRunDetail> => detail.status === "fulfilled",
  );
  if (!fulfilled.length) return;
  for (const detail of fulfilled) versions.set(detail.value.run.id, detail.value.run.updated_at);
  setDetails((existing) => {
    const next = { ...existing };
    for (const detail of fulfilled) next[detail.value.run.id] = detail.value;
    return next;
  });
}

function trackCapabilityDenials(
  surface: AgentDockDetailsOptions["surface"],
  actions: AgentToolboxAction[],
) {
  const denialCodes = new Set(
    actions.flatMap((action) => action.reasons.map((reason) => reason.code)),
  );
  denialCodes.forEach((reasonCode) =>
    analytics.track("agent_capability_denial_observed", {
      surface,
      reason_code: reasonCode,
    }),
  );
}
