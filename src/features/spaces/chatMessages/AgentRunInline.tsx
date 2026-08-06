import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, RotateCcw, Sparkles, Square } from "lucide-react";
import { Button } from "@/ui";
import type {
  SpaceMessageAgentRun,
  SpaceRun,
  SpaceRunDetail,
} from "@/models/interfaces/features/spaces/types";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export function AgentRunInline({ run: initial }: { run: SpaceMessageAgentRun }) {
  const [run, setRun] = useState(initial);
  const [detail, setDetail] = useState<SpaceRunDetail>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setRun(initial), [initial]);
  useEffect(() => {
    if (!run.run_id || run.state !== "awaiting_approval") return;
    void spacesApi
      .runDetail(run.run_id)
      .then(setDetail)
      .catch(() => undefined);
  }, [run.run_id, run.state]);

  const act = async (operation: () => Promise<SpaceRun>) => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      setRun((current) => ({ ...current, state: displayState(result.state) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The run could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  if (run.state === "completed") return null;
  const approval = detail?.approvals.find((item) => item.state === "pending");

  return (
    <div className="mt-2 max-w-xl rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 font-medium text-foreground">
        {run.state === "failed" ? (
          <AlertTriangle className="size-3.5 text-destructive" />
        ) : run.state === "queued" || run.state === "working" || run.state === "retrying" ? (
          <LoaderCircle className="size-3.5 animate-spin text-primary" />
        ) : (
          <Sparkles className="size-3.5 text-primary" />
        )}
        {statusLabel(run.state)}
      </div>
      {approval ? (
        <div className="mt-2 space-y-1 text-muted-foreground">
          <p>{approval.action_summary || "Review the requested Agent action."}</p>
          <p>Requester: you · Risk: approval required</p>
        </div>
      ) : null}
      {run.error_message || error ? (
        <p className="mt-1 text-destructive">{run.error_message || error}</p>
      ) : null}
      {run.run_id ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {run.state === "awaiting_approval" ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act(() => spacesApi.decideRun(run.run_id!, true))}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => spacesApi.decideRun(run.run_id!, false))}
              >
                Reject
              </Button>
            </>
          ) : null}
          {run.state === "failed" || run.state === "canceled" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => spacesApi.retryRun(run.run_id!))}
            >
              <RotateCcw className="size-3.5" /> Retry
            </Button>
          ) : null}
          {run.state === "working" || run.state === "queued" || run.state === "retrying" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => spacesApi.cancelRun(run.run_id!))}
            >
              <Square className="size-3" /> Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function displayState(state: SpaceRun["state"]): SpaceMessageAgentRun["state"] {
  if (state === "running" || state === "cooldown") return "working";
  if (state === "completed_with_errors" || state === "rejected") return "failed";
  return state;
}

function statusLabel(state: SpaceMessageAgentRun["state"]): string {
  switch (state) {
    case "queued":
      return "Agent queued";
    case "working":
      return "Agent working";
    case "retrying":
      return "Agent retrying";
    case "awaiting_approval":
      return "Approval required";
    case "failed":
      return "Agent run failed";
    case "canceled":
      return "Agent run canceled";
    default:
      return "Agent run completed";
  }
}
