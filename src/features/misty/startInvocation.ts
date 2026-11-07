import { chatDeviceGrants } from "@/features/agents/deviceGrants";
import { useCollaborationStore } from "@/features/agents/agentCollaboration";
import { admitLocalTurn } from "@/features/agents/localRun";
import { lessonTurnPayload, useLessonStore } from "@/features/agents";
import {
  runtimeAiApi as aiSurfaceApi,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "@/features/agents/AgentsRuntime";
import { useLocalExecution } from "@/features/agents/localExecution";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import type {
  AiCaptureAttachment,
  AiContextReference,
  AiInvocationRequest,
} from "@/features/ai-surface/types";
import { planDeepThinking } from "./conversationTurn";
import { globalMistyError, globalMistyId } from "./globalMistyActions";
import { historyTurns } from "./localChats";
import type { MistyState } from "./mistyState";
import {
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
} from "./mistyStoreHelpers";
import type { MistyGet, MistySet } from "./mistyStoreHelpers";
import { submissionEpoch } from "./mistySubmissionEpoch";
import { finishNeverStarted } from "./turnExecution";
import { turnStreamHandlers } from "./turnStream";
import type { GlobalAiMessage } from "./types";

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
      scheduled: Boolean(companion?.schedule),
    }).catch(() => undefined);
    const created = await aiSurfaceApi.createInvocation({
      agentId: get().conversations.find((c) => c.id === conversationId)?.agentId || requestAgentId,
      taskId: executionTaskId,
      executionMode: executionMode ?? "user",
      windowLabel: (await import("@/shared/platform/tauri")).hasTauriInternals()
        ? (await import("@tauri-apps/api/window")).getCurrentWindow().label
        : undefined,
      // The tab in front of the user, so "this page" means it. Only the
      // main window has one; private tabs never count.
      currentTab: (await import("@/shared/platform/tauri")).hasTauriInternals()
        ? (await import("@/features/agents/companion/normalTabs")).currentTabSummary()
        : undefined,
      // A scheduled turn has this argument too, but nobody is at the cursor: the crate words it as a report.
      mode: companion && !companion.schedule ? "companion" : "drawer",
      companionMode: companion?.interactionMode,
      displayCaptures: companion?.displayCaptures,
      methodVersionId: companion?.methodVersionId,
      methodInputs: companion?.methodInputs,
      ...(companion?.spaceId !== undefined && { spaceId: companion.spaceId }),
      ...(companion?.schedule && {
        scheduleId: companion.schedule.id,
        scheduleClaim: companion.schedule.claim,
      }),
      skillVersionIds: companion?.skillVersionIds,
      surfaceId: handoff?.surfaceId ?? "global",
      // Turns sent to carry on after a card read as events, not as typed messages.
      trigger: companion?.schedule
        ? "scheduled_task"
        : selection
          ? "selection"
          : companion?.continuation
            ? "continuation"
            : "message",
      requestedArtifactKind: handoff?.requestedArtifactKind,
      prompt: normalized,
      // Earlier turns from this device's copy of the chat.
      historyTurns: historyTurns(get().conversations.find((c) => c.id === conversationId)),
      historyNotes: get().conversations.find((c) => c.id === conversationId)?.historyNotes,
      // The run works on this computer.
      originDeviceId: await import("@/features/agents/workflows/deviceScheduledRuns")
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
            method: execution.method
              ? { ...execution.method, invocationId: created.invocationId }
              : undefined,
          },
        });
    }
    patchConversationMessage(set, get, conversationId, assistantMessage.id, {
      invocationId: created.invocationId,
    });
    // A scheduled run has its own modes, and leaves what the person chose in the composer for them.
    if (startsConversation && !companion?.schedule) {
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
