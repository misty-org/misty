import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { chatDeviceGrants } from "../../personal/device_grants";
import { useCollaborationStore } from "../../plans/agent_collaboration";
import { admitLocalTurn } from "../../local_run";
import { lessonTurnPayload } from "../../tutor/lessons/lesson_router";
import { useLessonStore } from "../../tutor/lessons/lesson_store";
import {
  runtimeAiApi as aiSurfaceApi,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "../../agents_runtime";
import { useLocalExecution } from "../../runs/local-execution/local_execution";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type {
  AiCaptureAttachment,
  AiContextReference,
  AiInvocationRequest,
} from "../../runs/invocations/invocation_types";
import { planDeepThinking } from "./conversation_turn";
import { globalMistyError, globalMistyId } from "../state/global_misty_actions";
import { historyTurns } from "../state/local_chats";
import type { MistyState } from "../state/misty_state";
import {
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
} from "../state/misty_store_updates";
import type { MistyGet, MistySet } from "../state/misty_store_updates";
import { submissionEpoch } from "./misty_submission_epoch";
import { finishNeverStarted } from "./turn_execution";
import { answerNotStarted } from "../view/failure_summary";
import { turnStreamHandlers } from "./turn_stream";
import type { GlobalAiMessage } from "../state/conversation_types";
import { thisComputerDeviceId } from "../../personal/use_agents_store";
import { HomeSpaceGone } from "../../runs/local-run/run_space";

type SubmitArgs = Parameters<MistyState["submitAnswer"]>;

const uncertainAdmissions = new Map<string, string>();

export function clearUncertainAdmissions() {
  uncertainAdmissions.clear();
}

interface PreparedTurn {
  accountId: string;
  epoch: number;
  spaceId: string;
  conversationId: string;
  normalized: string;
  attachments: NonNullable<SubmitArgs[1]>;
  selection?: AiSelectionSnapshot;
  companion: SubmitArgs[5];
  requestAgentId: string;
  handoff: MistyState["handoff"];
  executionMode: AiInvocationRequest["executionMode"];
  executionTaskId?: string;
  sourcePaneId?: string;
  capture?: AiCaptureAttachment;
  invocationContext: AiContextReference[];
  deviceContexts: AiInvocationDeviceContext[];
  startsConversation: boolean;
  permissionMode: AiInvocationRequest["permissionMode"];
  collaborationMode: AiInvocationRequest["collaborationMode"];
  requestedThinking: NonNullable<AiInvocationRequest["thinkingMode"]>;
  assistantMessage: GlobalAiMessage;
  markPreparation: (stage: string) => void;
}

export async function startInvocation(set: MistySet, get: MistyGet, turn: PreparedTurn) {
  const {
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
  } = turn;
  try {
    const admission = JSON.stringify([
      accountId,
      conversationId,
      normalized,
      attachments.map((a) => a.id),
    ]);
    const idempotencyKey =
      companion?.idempotencyKey ??
      uncertainAdmissions.get(admission) ??
      `global-answer-${globalMistyId()}`;
    uncertainAdmissions.set(admission, idempotencyKey);
    const grants = await chatDeviceGrants(conversationId, startsConversation);
    await admitLocalTurn(accountId, conversationId, {
      mode: collaborationMode,
      permissionMode,
    }).catch(() => undefined);
    const created = await aiSurfaceApi.createInvocation({
      agentId: get().conversations.find((c) => c.id === conversationId)?.agentId || requestAgentId,
      taskId: executionTaskId,
      executionMode: executionMode ?? "user",
      windowLabel: hasTauriInternals() ? getCurrentWindow().label : undefined,
      mode: companion ? "companion" : "drawer",
      companionMode: companion?.interactionMode,
      displayCaptures: companion?.displayCaptures,
      surfaceId: handoff?.surfaceId ?? "global",
      trigger: selection ? "selection" : companion?.continuation ? "continuation" : "message",
      requestedArtifactKind: handoff?.requestedArtifactKind,
      prompt: normalized,
      historyTurns: historyTurns(get().conversations.find((c) => c.id === conversationId)),
      historyNotes: get().conversations.find((c) => c.id === conversationId)?.historyNotes,
      originDeviceId: await thisComputerDeviceId()
        .then((id) => id ?? undefined)
        .catch(() => undefined),
      context: invocationContext,
      attachmentIds: attachments.map((attachment) => attachment.id),
      attachmentNames: Object.fromEntries(attachments.map((item) => [item.id, item.name])),
      deviceContexts: [
        ...deviceContexts,
        ...grants.filter((grant) => !deviceContexts.some((c) => c.opaqueRef === grant.opaqueRef)),
      ],
      thinkingMode: collaborationMode === "plan" && planDeepThinking() ? "deep" : requestedThinking,
      collaborationMode,
      ...(collaborationMode === "teach"
        ? lessonTurnPayload(
            useLessonStore.getState().lessons,
            conversationId,
            Date.now(),
            useLessonStore.getState().courses,
          )
        : {}),
      permissionMode,
      selection,
      capture,
      ...(conversationId.startsWith("local-")
        ? {}
        : {
            conversationId,
          }),
      idempotencyKey,
    });
    markPreparation("invocation_admitted");
    uncertainAdmissions.delete(admission);
    if (
      get().accountId !== accountId ||
      epoch !== submissionEpoch() ||
      (executionTaskId &&
        (useLocalExecution.getState().execution?.taskId !== executionTaskId ||
          useLocalExecution.getState().execution?.state !== "running"))
    ) {
      await aiSurfaceApi.cancelInvocation(created.invocationId).catch(() => {});
      return;
    }
    if (executionTaskId) {
      const execution = useLocalExecution.getState().execution;
      if (execution?.taskId === executionTaskId)
        useLocalExecution.setState({
          execution: {
            ...execution,
            conversationId,
          },
        });
    }
    patchConversationMessage(set, get, conversationId, assistantMessage.id, {
      invocationId: created.invocationId,
    });
    if (startsConversation) {
      useCollaborationStore.getState().adoptDraftMode(conversationId);
    }
    set({
      invocationId: created.invocationId,
      invocationConversationId: conversationId,
    });
    replaceActiveGlobalInvocationStream(
      subscribeToAiInvocation(
        created.eventsUrl,
        turnStreamHandlers(set, get, {
          accountId,
          epoch,
          invocationId: created.invocationId,
          conversationId,
          assistantMessageId: assistantMessage.id,
          executionTaskId,
          sourcePaneId,
          spaceId,
        }),
      ),
    );
  } catch (error) {
    if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
    patchConversationMessage(set, get, conversationId, assistantMessage.id, {
      content: error instanceof HomeSpaceGone ? error.message : answerNotStarted,
      state: "failed",
      retryable: true,
      activity: undefined,
    });
    set({
      working: false,
      error: error instanceof HomeSpaceGone ? null : globalMistyError(error),
    });
    if (executionTaskId) void finishNeverStarted(executionTaskId);
  }
}
