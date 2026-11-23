import { releasePendingWait } from "../../interventions/WaitingForYouCard";
import type { MistyImageAttachment } from "../state/conversation_types";
import { useMistyStore } from "../state/use_misty_store";
import type { Presentation } from "../../tutor/cursor/protocol";
import { continuationScreen } from "../../runs/jobs/execution_handoff";

export async function steerRunningTask(
  accountId: string,
  invocationId: string | undefined,
  prompt: string,
  conversationId: string | undefined,
) {
  await releasePendingWait(accountId, invocationId);
  await useMistyStore.getState().steerResponse?.(prompt, conversationId);
}

export async function submitWorkspaceMessage(
  prompt: string,
  attachments: MistyImageAttachment[],
  conversationId: string,
  resume: boolean,
  companion: Presentation,
) {
  const handoff = useMistyStore.getState().handoff;
  await useMistyStore.getState().submitAnswer(
    prompt,
    attachments,
    undefined,
    [],
    { conversationId, context: handoff?.context ?? [] },
    {
      executionMode: "user",
      interactionMode: companion.mode,
      ...(resume ? { ...continuationScreen(conversationId), continuation: true } : {}),
    },
  );
  if (handoff && handoff.surfaceId !== "files" && useMistyStore.getState().handoff === handoff)
    useMistyStore.setState({ handoff: undefined, context: [] });
}

export async function untilIdle(timeoutMs = 180_000): Promise<void> {
  const started = Date.now();
  let idle = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    idle = useMistyStore.getState().working ? 0 : idle + 1;
    if (idle >= 2) return;
  }
}
