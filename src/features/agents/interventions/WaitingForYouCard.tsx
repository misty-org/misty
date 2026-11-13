import { useEffect, useState } from "react";
import { Button, Surface, Text } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { resumeExecutionAfterWait } from "../runs/jobs/executionHandoff";
import { useLocalExecution } from "../runs/local-execution/localExecution";
import { interventionLabels } from "./api";
import { useAgentInterventions } from "./store";
import { QuestionChip, QuestionHint, QuestionText } from "../plans/AgentQuestionCard";
import { useNow } from "@/shared/hooks/useNow";

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
    // The run picks up again either way: to recheck the screen, or to stop.
    const execution = useLocalExecution.getState().execution;
    if (execution?.state === "waiting") await resumeExecutionAfterWait(execution.taskId);
  };
  const busy = store.busy === wait.id;
  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="xl"
      className="mb-2 grid gap-2.5 px-3 pt-3 pb-2.5"
      role="group"
      aria-label="Waiting for you"
    >
      <div className="flex items-center gap-2">
        <QuestionChip>Waiting for you</QuestionChip>
        <Text bare size="caption" tone="muted" className="flex-1">
          {agentName} · {wait.targetLabel || "Misty"}
        </Text>
      </div>
      <QuestionText>{interventionLabels[wait.action]}</QuestionText>
      <Text as="p" wrap size="meta" tone="muted" className="m-0 leading-normal whitespace-pre-wrap">
        {wait.reason}
      </Text>
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <div className="flex items-center gap-1.5">
        <QuestionHint>You have control. Finish it on screen, then continue.</QuestionHint>
        <Button variant="quiet" disabled={busy} onClick={() => void decide(false)}>
          Stop
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
          Done, continue
        </Button>
      </div>
    </Surface>
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
