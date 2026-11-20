import { releasePendingWait } from "../../interventions/WaitingForYouCard";
import type { MistyImageAttachment } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import type { Presentation } from "../../tutor/cursor/protocol";
import { continuationScreen } from "../../runs/jobs/executionHandoff";

/** Writing to a run that waits for you means you are back: the wait is released so the run
 * continues and reads this message. */
export async function steerRunningTask(
  accountId: string,
  invocationId: string | undefined,
  prompt: string,
  conversationId: string | undefined,
) {
  await releasePendingWait(accountId, invocationId);
  await useMistyStore.getState().steerResponse?.(prompt, conversationId);
}

/**
 * Sends a message typed in the Agents conversation. `resume` continues a run that handed off
 * on that run's screen.
 */
export async function submitWorkspaceMessage(
  prompt: string,
  attachments: MistyImageAttachment[],
  conversationId: string,
  resume: boolean,
  companion: Presentation,
) {
  const handoff = useMistyStore.getState().handoff;
  // The cursor companion is a separate surface; typing here never goes through it.
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
  // Folder work keeps its handoff for follow-ups; other context is sent once.
  if (handoff && handoff.surfaceId !== "files" && useMistyStore.getState().handoff === handoff)
    useMistyStore.setState({ handoff: undefined, context: [] });
}

/** Resolves once no run is working, checked twice in a row so the gap before a run starts doesn't count. */
export async function untilIdle(timeoutMs = 180_000): Promise<void> {
  const started = Date.now();
  let idle = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    idle = useMistyStore.getState().working ? 0 : idle + 1;
    if (idle >= 2) return;
  }
}
