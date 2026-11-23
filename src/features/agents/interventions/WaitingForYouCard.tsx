import { useEffect, useState } from "react";
import { Button, QuestionPanel, Text } from "@misty/ui";
import { resumeExecutionAfterWait } from "../runs/jobs/execution_handoff";
import { useLocalExecution } from "../runs/local-execution/local_execution";
import { interventionLabels } from "./api";
import { useAgentInterventions } from "./store";
import { useNow } from "@/shared/hooks/use_now";

export function WaitingForYouCard({
  accountId,
  invocationIds,
  agentName,
  revision,
}: {
  accountId: string;
  invocationIds: string[];
  agentName: string;
  revision?: unknown;
}) {
  const now = useNow();
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
          (item) => invocationIds.includes(item.runId) && Date.parse(item.expiresAt) > now,
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
    const execution = useLocalExecution.getState().execution;
    if (execution?.state === "waiting") await resumeExecutionAfterWait(execution.taskId);
  };
  const busy = store.busy === wait.id;
  return (
    <QuestionPanel
      label="Waiting for you"
      title={
        <Text wrap size="control" tone="bright" weight="medium">
          {interventionLabels[wait.action]}
        </Text>
      }
      aside={wait.targetLabel ? `${agentName} in ${wait.targetLabel}` : agentName}
      error={error}
      actions={
        <>
          <Button variant="quiet" disabled={busy} onClick={() => void decide(false)}>
            Stop
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
            Done, continue
          </Button>
        </>
      }
    >
      {wait.reason ? (
        <Text as="p" wrap size="meta" tone="muted" className="m-0 whitespace-pre-wrap">
          {wait.reason}
        </Text>
      ) : null}
      <Text as="p" wrap size="meta" tone="muted" className="m-0">
        You have control. Finish it on screen, then continue.
      </Text>
    </QuestionPanel>
  );
}

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
