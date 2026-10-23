import { releasePendingWait } from "@/features/agent-interventions/WaitingForYouCard";
import type { MistyImageAttachment } from "@/features/misty/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { Presentation } from "../companion/protocol";
import { continuationScreen } from "../executionHandoff";

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
    "workspace",
    [],
    { conversationId, context: handoff?.context ?? [] },
    {
      executionMode: "user",
      interactionMode: companion.mode,
      model: companion.model,
      ...(resume ? { ...continuationScreen(conversationId), continuation: true } : {}),
    },
  );
  // Folder work keeps its handoff for follow-ups; other context is sent once.
  if (handoff && handoff.surfaceId !== "files" && useMistyStore.getState().handoff === handoff)
    useMistyStore.setState({ handoff: undefined, browserRequest: undefined, context: [] });
}
