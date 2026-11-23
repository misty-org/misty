import { clientDebugEnabled } from "@/shared/platform/client_debug";
import { turnModes } from "../../plans/agent_collaboration";
import { loadLocalModes } from "@/features/agents/local_run";
import { settleLocalExecution } from "../../runs/local-execution/local_execution_state";
import { thinkingEffort, thinkingMode } from "../../runs/jobs/thinking_mode";
import { awaitConversationTitle, openTurn } from "./conversation_turn";
import { globalMistyError } from "../state/global_misty_actions";
import { conversationForGlobalPrompt } from "../state/global_misty_conversation_scope";
import type { MistyState } from "../state/misty_state";
import {
  globalAiContext,
  replaceActiveGlobalInvocationStream,
  updateConversation,
} from "../state/misty_store_updates";
import type { MistyGet, MistySet } from "../state/misty_store_updates";
import { advanceSubmissionEpoch, submissionEpoch } from "./misty_submission_epoch";
import { prepareTurnContext } from "./prepare_turn";
import { echoPrompt } from "./prompt_echo";
import { startInvocation } from "./start_invocation";
import { finishNeverStarted, settlePreviousExecution, startTurnExecution } from "./turn_execution";

export function createSubmitAnswer(set: MistySet, get: MistyGet): MistyState["submitAnswer"] {
  return async (prompt, attachments = [], selection, deviceContexts = [], origin, companion) => {
    const preparationStarted = performance.now();
    const markPreparation = (stage: string) => {
      if (companion && clientDebugEnabled())
        console.debug(
          "[companion preparation]",
          stage,
          Math.round(performance.now() - preparationStarted),
        );
    };
    const normalized = prompt.trim();
    if (!normalized && !attachments.length) return;
    if (get().working) {
      if (attachments.length) {
        set({ error: "Keep attachments for the next task; follow-ups can contain text only." });
        return;
      }
      try {
        await get().steerResponse?.(normalized, origin?.conversationId);
      } catch (error) {
        set({ error: globalMistyError(error) });
      }
      return;
    }
    const epoch = advanceSubmissionEpoch();
    const executionMode = companion?.executionMode ?? "user";
    const echo = echoPrompt(set, get, {
      prompt: normalized,
      attachments,
      echoed: !(companion?.idempotencyKey?.startsWith("voice-") || companion?.continuation),
      conversationId: origin?.conversationId,
    });
    const { userMessage, assistantMessage, isEcho, unshow } = echo;
    set({
      working: true,
      error: null,
      executionMode,
      invocationId: undefined,
      invocationConversationId: undefined,
      ...echo.patch,
    });
    const accountId = get().accountId;
    const requestState = origin
      ? {
          ...get(),
          activeConversationId: origin.conversationId,
        }
      : get();
    const handoff = companion && get().handoff?.surfaceId !== "files" ? undefined : get().handoff;
    let requestedThinking = thinkingMode(
      requestState.conversations.find((item) => item.id === requestState.activeConversationId)
        ?.reasoningEffort || thinkingEffort(requestState.thinkingMode ?? "normal"),
    );
    const spaceId = "";
    const prepared = await prepareTurnContext(set, get, {
      accountId,
      epoch,
      spaceId,
      origin,
      handoff,
      companion,
      requestAgentId: requestState.selectedAgentId,
      selection,
      deviceContexts,
      onContextReady: () => markPreparation("context_ready"),
    });
    if (!prepared) return unshow();
    const { requestAgentId, sourcePaneId, capture } = prepared;
    let { requestContext } = prepared;
    selection = prepared.selection;
    deviceContexts = prepared.deviceContexts;
    let executionTaskId: string | undefined;
    if (executionMode !== "user") {
      const execution = await startTurnExecution(set, get, {
        accountId,
        epoch,
        requestAgentId,
        companion,
        requestContext,
      });
      if (!execution) return unshow();
      executionTaskId = execution.taskId;
      requestContext = execution.requestContext;
      deviceContexts = execution.deviceContexts;
    } else {
      await settlePreviousExecution();
    }
    let conversationId: string;
    markPreparation("execution_ready");
    try {
      conversationId = await conversationForGlobalPrompt(
        () => ({
          ...requestState,
          selectedAgentId: requestAgentId,
          context: requestContext,
        }),
        normalized,
      );
    } catch (error) {
      if (executionTaskId) await finishNeverStarted(executionTaskId);
      if (get().accountId === accountId && epoch === submissionEpoch())
        set({
          working: false,
          error: globalMistyError(error),
        });
      return unshow();
    }
    if (get().accountId !== accountId || epoch !== submissionEpoch()) {
      if (executionTaskId) await settleLocalExecution("paused", executionTaskId);
      return unshow();
    }
    markPreparation("conversation_ready");
    if (!requestState.thinkingModeExplicit && requestedThinking !== "deep") {
      requestedThinking = thinkingMode(
        get().conversations.find((c) => c.id === conversationId)?.reasoningEffort ||
          thinkingEffort(requestedThinking),
      );
    }
    const invocationContext = globalAiContext(requestContext);
    const startsConversation = !get()
      .conversations.find((c) => c.id === conversationId)
      ?.messages.some((message) => !isEcho(message));
    if (!startsConversation) await loadLocalModes(accountId, conversationId).catch(() => undefined);
    const modes = turnModes(conversationId, startsConversation);
    const permissionMode = companion?.permissionMode ?? modes.permissionMode;
    const collaborationMode = companion?.collaborationMode ?? modes.collaborationMode;
    echo.settle(conversationId);
    if (startsConversation && !companion?.continuation)
      awaitConversationTitle(conversationId, normalized, normalized.slice(0, 56));
    updateConversation(set, get, conversationId, (conversation) =>
      openTurn(conversation, {
        prompt: normalized,
        userMessage,
        assistantMessage,
        isEcho,
        echoed: echo.echoed,
        continuation: Boolean(companion?.continuation),
        reasoningEffort: thinkingEffort(requestedThinking),
      }),
    );
    set({
      working: true,
      error: null,
      query: "",
      context: [],
    });
    replaceActiveGlobalInvocationStream();
    await startInvocation(set, get, {
      accountId,
      epoch,
      spaceId,
      conversationId,
      normalized,
      attachments,
      selection,
      companion,
      requestAgentId,
      handoff,
      executionMode,
      executionTaskId,
      sourcePaneId,
      capture,
      invocationContext,
      deviceContexts,
      startsConversation,
      permissionMode,
      collaborationMode,
      requestedThinking,
      assistantMessage,
      markPreparation,
    });
  };
}
