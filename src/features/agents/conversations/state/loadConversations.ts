import { subscribeAgentsInvocation as subscribeToAiInvocation } from "@/features/agents/AgentsRuntime";
import { adoptSignedOutAgents } from "../../personal/agentAccount";
import { followAddress } from "../../runs/local-run/localRunParts";
import type { MistyState } from "./mistyState";
import {
  applyGlobalInvocationEvent,
  normalizeConversation,
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  type MistyGet,
  type MistySet,
} from "./mistyStoreUpdates";
import { settleRun } from "../ask/settleRun";
import { useCollaborationStore } from "../../plans/agentCollaboration";
import { localChats, markStoredChats } from "./localChats";
import { syncLocalChats } from "./localChatSync";
import { submissionEpoch } from "../ask/mistySubmissionEpoch";

/**
 * Loads this device's chats and re-attaches to a run still going. `reconnect` keeps the open conversation; `expected` names the run to rejoin.
 */
export function createLoadConversations(
  set: MistySet,
  get: MistyGet,
): MistyState["loadConversations"] {
  return async (reconnect = false, expected) => {
    const epoch = submissionEpoch();
    const accountId = get().accountId;
    if (!accountId) return;
    set({
      conversationsLoading: true,
    });
    try {
      // Chats live on this device.
      // Native code may ask the person first, which the chats on this account don't wait for.
      void adoptSignedOutAgents(accountId).then((moved) => {
        if (moved > 0 && get().accountId === accountId) void get().loadConversations(reconnect);
      });
      const saved = await localChats.conversations(accountId).catch(() => []);
      const local = saved.map(normalizeConversation);
      markStoredChats(local);
      if (get().accountId === accountId && !get().working && !get().conversations.length)
        set({ conversations: local });
      const response = {
        conversations: await syncLocalChats(accountId, local, () => get().invocationId),
      };
      if (get().accountId !== accountId) return;
      if ((get().working && !reconnect) || epoch !== submissionEpoch()) {
        set({
          conversationsLoading: false,
        });
        return;
      }
      const conversations = response.conversations.map(normalizeConversation);
      // What the sync returned is saved already.
      markStoredChats(conversations);
      if (
        expected &&
        (expected.accountId !== accountId ||
          get().selectedAgentId !== expected.agentId ||
          get().activeConversationId !== expected.conversationId ||
          !conversations.some(
            (conversation) =>
              conversation.id === expected.conversationId &&
              // Misty's own chats may carry no agent.
              (!conversation.agentId || conversation.agentId === expected.agentId) &&
              conversation.messages.some(
                (message) =>
                  message.role === "assistant" && message.invocationId === expected.invocationId,
              ),
          ))
      ) {
        set({ conversationsLoading: false });
        return;
      }
      const activeConversationId =
        get().activeConversationId || (get().selectedAgentId ? "" : conversations[0]?.id) || "";
      set({
        conversations,
        pendingArtifact: conversations
          .find((c) => c.id === activeConversationId)
          ?.messages.slice()
          .reverse()
          .find((m) => m.artifact)?.artifact,
        artifactConversationId: activeConversationId,
        artifactPaneId: undefined,
        activeConversationId,
        selectedAgentId:
          conversations.find((item) => item.id === activeConversationId)?.agentId ||
          get().selectedAgentId,
        conversationsLoading: false,
      });
      if (reconnect) {
        replaceActiveGlobalInvocationStream();
        set({
          working: false,
          error: null,
          ...(expected
            ? {
                invocationId: expected.invocationId,
                invocationConversationId: expected.conversationId,
              }
            : {}),
        });
      }
      const candidates = [...conversations].sort(
        (a, b) => Number(b.id === activeConversationId) - Number(a.id === activeConversationId),
      );
      const running = candidates.flatMap((conversation) =>
        conversation.messages
          .filter(
            (message) =>
              message.role === "assistant" &&
              message.invocationId &&
              (!expected ||
                (conversation.id === expected.conversationId &&
                  message.invocationId === expected.invocationId)) &&
              (message.state === "pending" || message.state === "streaming"),
          )
          .map((message) => ({ conversation, message })),
      )[0];
      if (running) {
        const { conversation, message } = running;
        const invocationId = message.invocationId!;
        set({ working: true, invocationId, invocationConversationId: conversation.id });
        // Replay what the run has said into an empty response, so deltas are never duplicated.
        patchConversationMessage(set, get, conversation.id, message.id, {
          content: "",
          activity: "Reconnecting to the task…",
        });
        replaceActiveGlobalInvocationStream(
          subscribeToAiInvocation(followAddress(invocationId), {
            onEvent: (event) => {
              if (
                get().accountId !== accountId ||
                get().invocationId !== invocationId ||
                epoch !== submissionEpoch()
              )
                return;
              applyGlobalInvocationEvent(set, get, conversation.id, message.id, event);
              if (
                ["invocation.completed", "invocation.failed", "invocation.canceled"].includes(
                  event.type,
                )
              )
                useCollaborationStore.getState().afterRunSettled(conversation.id);
              if (event.type === "artifact.proposed" || event.type === "approval.required") {
                patchConversationMessage(set, get, conversation.id, message.id, {
                  artifact: event.artifact,
                });
                set({ pendingArtifact: event.artifact, artifactConversationId: conversation.id });
              }
            },
            onError: (error) => {
              if (get().accountId !== accountId || get().invocationId !== invocationId) return;
              // A reattach that drops again ends here; the next reload retries.
              settleRun(set, get, {
                state: "failed",
                conversationId: conversation.id,
                error: error.message,
              });
            },
          }),
        );
      }
    } catch {
      if (get().accountId === accountId)
        set({
          conversationsLoading: false,
        });
    }
  };
}
