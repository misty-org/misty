import { useCollaborationStore } from "../../plans/agent_collaboration";
import { awaitUserForExecution, resumeExecutionAfterWait } from "../../runs/jobs/execution_handoff";
import { settleLocalExecution } from "../../runs/local-execution/local_execution_state";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { globalMistyError } from "../state/global_misty_actions";
import { applyGlobalInvocationEvent, patchConversationMessage } from "../state/misty_store_updates";
import { settleRun } from "./settle_run";
import { requestHostContext } from "../context/context_bridge";
import { continueAfterScreenRequest } from "../context/screen_requests";
import { submissionEpoch } from "./misty_submission_epoch";
import type { MistyGet, MistySet } from "../state/misty_store_updates";
import type { subscribeToAiInvocation } from "../../runs/invocations/api";
import { useAgentInterventions } from "../../interventions/store";

interface StreamedTurn {
  accountId: string;
  epoch: number;
  invocationId: string;
  conversationId: string;
  assistantMessageId: string;
  executionTaskId?: string;
  sourcePaneId?: string;
  spaceId: string;
}

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
        if (turn.executionTaskId) void awaitUserForExecution(turn.executionTaskId);
        useAgentInterventions.getState().setAccount(turn.accountId);
        void useAgentInterventions.getState().refresh();
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
        useCollaborationStore.getState().afterRunSettled(turn.conversationId);
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
