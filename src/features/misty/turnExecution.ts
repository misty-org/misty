import { visibleAutopilotAvailable } from "@/features/agents/betaModes";
import {
  finishLocalExecution,
  pauseLocalExecution,
  settleLocalExecution,
  startLocalExecution,
  useLocalExecution,
} from "@/features/agents/localExecution";
import type { AiInvocationDeviceContext } from "@/features/ai-surface";
import { globalMistyError } from "./globalMistyActions";
import type { MistyState } from "./mistyState";
import type { MistyGet, MistySet } from "./mistyStoreHelpers";
import { submissionEpoch } from "./mistySubmissionEpoch";
import type { GlobalAiContextRef } from "./types";

type Companion = Parameters<MistyState["submitAnswer"]>[6];

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
      ...(companion?.openScreen
        ? {
            normalTabs: true,
            openWhenMissing: true,
            url: companion.openScreen.url,
            hint: companion.openScreen.hint,
            tabId: companion.openScreen.tabId,
            place: companion.openScreen.place,
          }
        : visibleAutopilotAvailable()
          ? { normalTabs: false, desktopControl: true }
          : { normalTabs: false }),
      method: companion?.methodVersionId
        ? {
            versionId: companion.methodVersionId,
            inputs: companion.methodInputs,
            skillVersionIds: companion.skillVersionIds,
          }
        : undefined,
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
