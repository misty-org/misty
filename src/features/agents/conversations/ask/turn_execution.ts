import { invoke } from "@tauri-apps/api/core";
import { visibleAutopilotAvailable } from "../../page/beta_modes";
import {
  finishLocalExecution,
  pauseLocalExecution,
  settleLocalExecution,
  useLocalExecution,
} from "../../runs/local-execution/local_execution_state";
import { startLocalExecution } from "../../runs/local-execution/local_execution_start";
import type { AiInvocationDeviceContext } from "../../runs/invocations";
import { globalMistyError } from "../state/global_misty_actions";
import type { MistyState } from "../state/misty_state";
import type { MistyGet, MistySet } from "../state/misty_store_updates";
import { submissionEpoch } from "./misty_submission_epoch";
import type { GlobalAiContextRef } from "../state/conversation_types";

type Companion = Parameters<MistyState["submitAnswer"]>[5];

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
      desktopControl: visibleAutopilotAvailable() && !companion?.openScreen ? true : undefined,
    });
    if (companion?.turn !== undefined) {
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

export async function settlePreviousExecution() {
  if (useLocalExecution.getState().execution?.state === "waiting") {
    await pauseLocalExecution();
  } else if (useLocalExecution.getState().execution?.state === "running") {
    await settleLocalExecution("paused");
  }
}

export async function finishNeverStarted(taskId: string) {
  if (useLocalExecution.getState().execution?.taskId !== taskId) return;
  await finishLocalExecution();
}
