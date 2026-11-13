import { visibleAutopilotAvailable } from "../../page/betaModes";
import {
  finishLocalExecution,
  pauseLocalExecution,
  settleLocalExecution,
  startLocalExecution,
  useLocalExecution,
} from "../../runs/local-execution/localExecution";
import type { AiInvocationDeviceContext } from "../../runs/invocations";
import { globalMistyError } from "../state/globalMistyActions";
import type { MistyState } from "../state/mistyState";
import type { MistyGet, MistySet } from "../state/mistyStoreUpdates";
import { submissionEpoch } from "./mistySubmissionEpoch";
import type { GlobalAiContextRef } from "../state/conversationTypes";

type Companion = Parameters<MistyState["submitAnswer"]>[5];

/**
 * Starts the local task an agent turn works in, with the tab it opens when asked. Undefined
 * when the turn was replaced or the task could not start; a failure is already shown.
 */
export async function startTurnExecution(
  set: MistySet,
  get: MistyGet,
  input: {
    accountId: string;
    epoch: number;
    requestAgentId: string;
    companion: Companion;
    requestContext: GlobalAiContextRef[];
  },
): Promise<
  | {
      taskId: string;
      requestContext: GlobalAiContextRef[];
      deviceContexts: AiInvocationDeviceContext[];
    }
  | undefined
> {
  const { accountId, epoch, requestAgentId, companion, requestContext } = input;
  try {
    const execution = await startLocalExecution(accountId, requestAgentId, {
      // A run always works in a page of its own, shown as the picture beside its chat. There
      // are no tabs of the person's to work in.
      desktopControl: visibleAutopilotAvailable() && !companion?.openScreen ? true : undefined,
    });
    if (companion?.turn !== undefined) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("cursor_companion_bind_task", {
        turn: companion.turn,
        taskId: execution.taskId,
      });
    }
    if (get().accountId !== accountId || epoch !== submissionEpoch()) {
      await settleLocalExecution("paused", execution.taskId);
      return undefined;
    }
    return {
      taskId: execution.taskId,
      requestContext: [
        ...requestContext.filter((ref) => ref.kind !== "browser-tab"),
        ...execution.context,
      ],
      deviceContexts: execution.deviceContexts,
    };
  } catch (error) {
    set({
      working: false,
      error: globalMistyError(error),
    });
    return undefined;
  }
}

/** A turn in the person's own mode leaves the local task before it: paused or settled. */
export async function settlePreviousExecution() {
  if (useLocalExecution.getState().execution?.state === "waiting") {
    // A new message replaces whatever the waiting run asked for.
    await pauseLocalExecution();
  } else if (useLocalExecution.getState().execution?.state === "running") {
    await settleLocalExecution("paused");
  }
}

/** Ends the local task of a run that never started: finished, released, its windows closed. */
export async function finishNeverStarted(taskId: string) {
  if (useLocalExecution.getState().execution?.taskId !== taskId) return;
  await finishLocalExecution();
}
