import { useEffect, useState } from "react";
import { Button } from "@/shared/ui";
import { resumeExecutionAfterWait } from "@/features/agents/executionHandoff";
import { useLocalExecution } from "@/features/agents/localExecution";
import { interventionLabels } from "./api";
import { useAgentInterventions } from "./store";
import "@/features/agents/collaborationStyles";

/**
 * What a suspended run needs from the person (a sign-in, a challenge, a review),
 * above the composer. The run keeps its screen while it waits; control is the
 * person's until they continue or stop it.
 */
export function WaitingForYouCard({
  accountId,
  invocationIds,
  agentName,
  revision,
}: {
  accountId: string;
  /** The conversation's runs; only their requests show here. */
  invocationIds: string[];
  agentName: string;
  /** Changes whenever the conversation's run starts or settles. */
  revision?: unknown;
}) {
  const store = useAgentInterventions();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!accountId) return;
    useAgentInterventions.getState().setAccount(accountId);
    void useAgentInterventions.getState().refresh();
  }, [accountId, revision]);
  const wait =
    store.accountId === accountId
      ? store.items.find(
          (item) => invocationIds.includes(item.runId) && Date.parse(item.expiresAt) > Date.now(),
        )
      : undefined;
  if (!wait) return null;
  const decide = async (ready: boolean) => {
    setError("");
    const saved = await useAgentInterventions.getState().decide(accountId, wait.id, ready);
    if (!saved) {
      setError(useAgentInterventions.getState().error || "Misty couldn't save that. Try again.");
      return;
    }
    // The run picks up again either way: to recheck the screen, or to stop.
    const execution = useLocalExecution.getState().execution;
    if (execution?.state === "waiting") await resumeExecutionAfterWait(execution.taskId);
  };
  const busy = store.busy === wait.id;
  return (
    <div className="agent-question-card" role="group" aria-label="Waiting for you">
      <div className="agent-question-head">
        <span className="agent-question-chip">Waiting for you</span>
        <span className="agent-question-count">
          {agentName} · {wait.targetLabel || "Misty"}
        </span>
      </div>
      <p className="agent-question-text">{interventionLabels[wait.action]}</p>
      <p className="agent-waiting-reason">{wait.reason}</p>
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
      <div className="agent-question-actions">
        <span className="agent-question-hint">
          You have control. Finish it on screen, then continue.
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide(false)}>
          Stop
        </Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide(true)}>
          Done, continue
        </Button>
      </div>
    </div>
  );
}

/**
 * Resume from a task's own controls: when its run is waiting for the person,
 * Resume means "I've done it" and releases the wait. Returns false when nothing
 * was waiting, so the caller can send its usual follow-up instead.
 */
export async function releasePendingWait(accountId: string, invocationId?: string) {
  if (!accountId || !invocationId) return false;
  const store = useAgentInterventions.getState();
  store.setAccount(accountId);
  await store.refresh();
  const wait = useAgentInterventions.getState().items.find((item) => item.runId === invocationId);
  if (!wait) return false;
  if (!(await useAgentInterventions.getState().decide(accountId, wait.id, true))) return false;
  const execution = useLocalExecution.getState().execution;
  if (execution?.state === "waiting") await resumeExecutionAfterWait(execution.taskId);
  return true;
}
