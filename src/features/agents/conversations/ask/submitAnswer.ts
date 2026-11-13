import { turnModes } from "../../plans/agentCollaboration";
import { loadLocalModes } from "@/features/agents/localRun";
import { settleLocalExecution } from "../../runs/local-execution/localExecution";
import { thinkingEffort, thinkingMode } from "../../runs/jobs/thinkingMode";
import { awaitConversationTitle, openTurn } from "./conversationTurn";
import { globalMistyError } from "../state/globalMistyActions";
import { conversationForGlobalPrompt } from "../state/globalMistyConversationScope";
import type { MistyState } from "../state/mistyState";
import {
  globalAiContext,
  replaceActiveGlobalInvocationStream,
  updateConversation,
} from "../state/mistyStoreUpdates";
import type { MistyGet, MistySet } from "../state/mistyStoreUpdates";
import { advanceSubmissionEpoch, submissionEpoch } from "./mistySubmissionEpoch";
import { prepareTurnContext } from "./prepareTurn";
import { echoPrompt } from "./promptEcho";
import { startInvocation } from "./startInvocation";
import { finishNeverStarted, settlePreviousExecution, startTurnExecution } from "./turnExecution";

/** Sends one turn: gathers its context, starts any local task, then streams the answer. */
export function createSubmitAnswer(set: MistySet, get: MistyGet): MistyState["submitAnswer"] {
  return async (prompt, attachments = [], selection, deviceContexts = [], origin, companion) => {
    const preparationStarted = performance.now();
    const markPreparation = (stage: string) => {
      if (companion)
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
    // Where work happens is decided per task: a screen opens only when the
    // agent asks for one, and its continuation names the mode.
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
      // The run never started, so its local task ends here with its windows, not paused beside a
      // failure.
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
    // A conversation's resolved defaults apply only when the composer has no
    // explicit choice. Existing conversation choices keep their precedence.
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
    // The companion in Teach mode sends every turn as a lesson step.
    const collaborationMode = companion?.collaborationMode ?? modes.collaborationMode;
    echo.settle(conversationId);
    // The server names a new conversation with a separate model call; until then its title is a skeleton.
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
