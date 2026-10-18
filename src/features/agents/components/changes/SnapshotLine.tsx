import { useEffect, useState } from "react";
import { Button } from "@/shared/ui";
import { runSnapshotSpace, saveProjectSnapshot } from "../../agentArtifacts";
import { plainFailure } from "./undoText";

type Status =
  | { state: "checking" }
  | { state: "saved"; space: string }
  | { state: "missing" }
  | { state: "saving" }
  | { state: "failed"; message: string };

/**
 * Where a run's project snapshot went: the device saves one to the agent's
 * Space when a run finishes. When none is there (it failed, or the run was
 * older), the person can save one now.
 */
export function SnapshotLine({
  agentId,
  scopeId,
  runId,
  conversationId,
  name,
}: {
  agentId: string;
  scopeId: string;
  runId: string;
  conversationId?: string;
  name: string;
}) {
  const [status, setStatus] = useState<Status>({ state: "checking" });
  useEffect(() => {
    let live = true;
    void runSnapshotSpace(agentId, runId)
      .then((space) => live && setStatus(space ? { state: "saved", space } : { state: "missing" }))
      .catch(() => live && setStatus({ state: "missing" }));
    return () => {
      live = false;
    };
  }, [agentId, runId]);
  const save = async () => {
    setStatus({ state: "saving" });
    try {
      const { space } = await saveProjectSnapshot({ agentId, scopeId, runId, conversationId });
      setStatus({ state: "saved", space: space.name });
    } catch (problem) {
      setStatus({
        state: "failed",
        message: plainFailure(problem, "A snapshot couldn’t be saved to the agent’s Space."),
      });
    }
  };
  if (status.state === "checking") return null;
  if (status.state === "saved")
    return (
      <p className="misty-diff-note">
        A snapshot of {name} is saved in {status.space}.
      </p>
    );
  return (
    <p
      className="misty-diff-note flex items-center gap-2"
      role={status.state === "failed" ? "alert" : undefined}
    >
      <span>
        {status.state === "failed"
          ? status.message
          : `${name} isn’t saved to the agent’s Space yet.`}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={status.state === "saving"}
        onClick={() => void save()}
      >
        {status.state === "failed" ? "Try again" : "Save a snapshot"}
      </Button>
    </p>
  );
}
