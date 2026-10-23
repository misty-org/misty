import { useCollaborationStore } from "@/features/agents/agentCollaboration";
import {
  awaitUserForExecution,
  resumeExecutionAfterWait,
} from "@/features/agents/executionHandoff";
import { settleLocalExecution } from "@/features/agents/localExecution";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { globalMistyError } from "./globalMistyActions";
import { applyGlobalInvocationEvent, patchConversationMessage } from "./mistyStoreHelpers";
import { settleRun } from "./settleRun";
import { requestHostContext } from "./contextBridge";
import { continueAfterScreenRequest } from "./screenRequests";
import { submissionEpoch } from "./mistySubmissionEpoch";
import type { MistyGet, MistySet } from "./mistyStoreHelpers";
import type { subscribeToAiInvocation } from "@/features/ai-surface/api";

/** The turn a stream belongs to; events for any other turn are ignored. */
export interface StreamedTurn {
  accountId: string;
  epoch: number;
  invocationId: string;
  conversationId: string;
  assistantMessageId: string;
  /** The local task running the turn on this computer, if any. */
  executionTaskId?: string;
  /** The pane whose page the turn is about, told about every event. */
  sourcePaneId?: string;
  spaceId: string;
}

/** Applies a turn's streamed events to its conversation, local task and source pane. */
export function turnStreamHandlers(
  set: MistySet,
  get: MistyGet,
  turn: StreamedTurn,
): Parameters<typeof subscribeToAiInvocation>[1] {
  return {
    onEvent: (event) => {
      if (get().accountId !== turn.accountId || turn.epoch !== submissionEpoch()) return;
      if (get().invocationId !== turn.invocationId) return;
      applyGlobalInvocationEvent(set, get, turn.conversationId, turn.assistantMessageId, event);
      if (event.type === "invocation.completed")
        void continueAfterScreenRequest(set, get, turn.conversationId, turn.assistantMessageId);
      if (event.type === "assistant.status" && event.phase === "awaiting_intervention") {
        // The run is suspended until the person acts. It keeps its screen;
        // input and the control ring go back to them, and the request
        // shows as a Waiting for you card in this conversation.
        if (turn.executionTaskId) void awaitUserForExecution(turn.executionTaskId);
        void import("@/features/agent-interventions/store").then(({ useAgentInterventions }) => {
          useAgentInterventions.getState().setAccount(turn.accountId);
          return useAgentInterventions.getState().refresh();
        });
      } else if (
        turn.executionTaskId &&
        ((event.type === "assistant.status" && event.phase === "intervention_resume_pending") ||
          event.type === "tool.started" ||
          event.type === "response.delta")
      ) {
        void resumeExecutionAfterWait(turn.executionTaskId);
      }
      if (
        ["invocation.completed", "invocation.failed", "invocation.canceled"].includes(event.type)
      ) {
        if (turn.executionTaskId)
          void settleLocalExecution(
            event.type === "invocation.completed" ? "finished" : "paused",
            turn.executionTaskId,
          );
        void usePersonalAgentsStore.getState().load(turn.accountId);
        // A pursued goal continues on the server; attach to its next run.
        useCollaborationStore.getState().afterRunSettled(
          turn.conversationId,
          () => void get().loadConversations(true),
          () => get().working,
        );
      }
      if (event.type === "artifact.proposed" || event.type === "approval.required") {
        patchConversationMessage(set, get, turn.conversationId, turn.assistantMessageId, {
          artifact: event.artifact,
        });
        set({
          pendingArtifact: event.artifact,
          artifactPaneId: turn.sourcePaneId,
          artifactConversationId: turn.conversationId,
        });
      }
      if (event.type === "effect.applied")
        set({
          pendingArtifact: undefined,
        });
      if (turn.sourcePaneId)
        void requestHostContext({
          accountId: turn.accountId,
          spaceId: turn.spaceId,
          targets: [],
          paneId: turn.sourcePaneId,
          event,
        }).catch((error) =>
          set({
            error: globalMistyError(error),
          }),
        );
    },
    onError: (streamError) => {
      if (
        get().accountId !== turn.accountId ||
        turn.epoch !== submissionEpoch() ||
        get().invocationId !== turn.invocationId
      )
        return;
      const current = get()
        .conversations.find((conversation) => conversation.id === turn.conversationId)
        ?.messages.find((message) => message.id === turn.assistantMessageId);
      // Never leave the spinner on for a stream that is gone. Reloading
      // from the server re-attaches if the task is still running.
      settleRun(set, get, {
        state: "failed",
        conversationId: turn.conversationId,
        error: streamError.message,
        patch: {
          content:
            current?.content || "Misty lost the response stream. Review the task before retrying.",
        },
      });
      if (turn.executionTaskId) void settleLocalExecution("paused", turn.executionTaskId);
      void get().loadConversations(true);
    },
  };
}
