import { chatDeviceGrants } from "../../personal/deviceGrants";
import { useCollaborationStore } from "../../plans/agentCollaboration";
import { admitLocalTurn } from "@/features/agents/localRun";
import { lessonTurnPayload } from "../../tutor/lessons/lessonRouter";
import { useLessonStore } from "../../tutor/lessons/lessonStore";
import {
  runtimeAiApi as aiSurfaceApi,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "@/features/agents/AgentsRuntime";
import { useLocalExecution } from "../../runs/local-execution/localExecution";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type {
  AiCaptureAttachment,
  AiContextReference,
  AiInvocationRequest,
} from "../../runs/invocations/invocationTypes";
import { planDeepThinking } from "./conversationTurn";
import { globalMistyError, globalMistyId } from "../state/globalMistyActions";
import { historyTurns } from "../state/localChats";
import type { MistyState } from "../state/mistyState";
import {
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
} from "../state/mistyStoreUpdates";
import type { MistyGet, MistySet } from "../state/mistyStoreUpdates";
import { chatSpaceId } from "../state/conversationSpace";
import { submissionEpoch } from "./mistySubmissionEpoch";
import { finishNeverStarted } from "./turnExecution";
import { turnStreamHandlers } from "./turnStream";
import type { GlobalAiMessage } from "../state/conversationTypes";

type SubmitArgs = Parameters<MistyState["submitAnswer"]>;

// Starts that may have gone through without answering; a retry reuses their key.
const uncertainAdmissions = new Map<string, string>();

export function clearUncertainAdmissions() {
  uncertainAdmissions.clear();
}

/** One turn, ready to send: everything submitAnswer gathered before its run starts. */
interface PreparedTurn {
  accountId: string;
  epoch: number;
  spaceId: string;
  conversationId: string;
  normalized: string;
  attachments: NonNullable<SubmitArgs[1]>;
  selection?: AiSelectionSnapshot;
  companion: SubmitArgs[6];
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
  /** Logs how long the companion's turn took to reach `stage`. */
  markPreparation: (stage: string) => void;
}

/**
 * Starts a prepared turn's run on this computer and follows it. A start that's refused marks the
 * answer failed and ends the turn's local task.
 */
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
    // The chat's folder and this computer's Misty browser travel with a desktop chat.
    const grants = await chatDeviceGrants(conversationId, startsConversation);
    await admitLocalTurn(accountId, conversationId, {
      mode: collaborationMode,
      permissionMode,
    }).catch(() => undefined);
    const chat = get().conversations.find((c) => c.id === conversationId);
    const chatSpace = chat ? chatSpaceId(chat) : "";
    const created = await aiSurfaceApi.createInvocation({
      agentId: get().conversations.find((c) => c.id === conversationId)?.agentId || requestAgentId,
      taskId: executionTaskId,
      executionMode: executionMode ?? "user",
      windowLabel: (await import("@/shared/platform/tauri")).hasTauriInternals()
        ? (await import("@tauri-apps/api/window")).getCurrentWindow().label
        : undefined,
      mode: companion ? "companion" : "drawer",
      companionMode: companion?.interactionMode,
      displayCaptures: companion?.displayCaptures,
      // The run works in its chat's one Space; Space tools reach no other (tools/space/routing).
      ...(companion?.spaceId !== undefined
        ? { spaceId: companion.spaceId }
        : chatSpace && { spaceId: chatSpace }),
      surfaceId: handoff?.surfaceId ?? "global",
      // Turns sent to carry on after a card read as events, not as typed messages.
      trigger: selection ? "selection" : companion?.continuation ? "continuation" : "message",
      requestedArtifactKind: handoff?.requestedArtifactKind,
      prompt: normalized,
      // Earlier turns from this device's copy of the chat.
      historyTurns: historyTurns(get().conversations.find((c) => c.id === conversationId)),
      historyNotes: get().conversations.find((c) => c.id === conversationId)?.historyNotes,
      // The run works on this computer.
      originDeviceId: await import("@/features/agents/personal/useAgentsStore")
        .then(({ thisComputerDeviceId }) => thisComputerDeviceId())
        .then((id) => id ?? undefined)
        .catch(() => undefined),
      context: invocationContext,
      attachmentIds: attachments.map((attachment) => attachment.id),
      attachmentNames: Object.fromEntries(attachments.map((item) => [item.id, item.name])),
      deviceContexts: [
        ...deviceContexts,
        ...grants.filter((grant) => !deviceContexts.some((c) => c.opaqueRef === grant.opaqueRef)),
      ],
      // Plan turns may think harder (Settings → Agents → Think harder while planning).
      thinkingMode: collaborationMode === "plan" && planDeepThinking() ? "deep" : requestedThinking,
      collaborationMode,
      ...(companion?.mediaContext ? { mediaContext: companion.mediaContext } : {}),
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
      content: "Misty could not start this answer. Ordinary search is still available.",
      state: "failed",
      retryable: true,
      activity: undefined,
    });
    set({
      working: false,
      error: globalMistyError(error),
    });
    // A refused start ends its local task and closes its windows: left paused, the task
    // looked as if it were still running next to "Misty could not start this answer".
    if (executionTaskId) void finishNeverStarted(executionTaskId);
  }
}
