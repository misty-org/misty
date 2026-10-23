import { subscribeAgentsInvocation as subscribeToAiInvocation } from "@/features/agents/AgentsRuntime";
import { globalMistyApi } from "./globalMistyApi";
import type { MistyState } from "./mistyState";
import {
  applyGlobalInvocationEvent,
  normalizeConversation,
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  type MistyGet,
  type MistySet,
} from "./mistyStoreHelpers";
import { settleRun } from "./settleRun";
import { useCollaborationStore } from "@/features/agents/agentCollaboration";
import { localChats, markStoredChats } from "./localChats";
import { syncLocalChats } from "./localChatSync";
import { submissionEpoch } from "./mistySubmissionEpoch";

/**
 * Loads this device's chats and the server's, merges them, and re-attaches to a run still
 * streaming. `reconnect` keeps the open conversation; `expected` names the run to rejoin.
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
      // Chats live on this device (docs/agents/chats-local.md). Its copy
      // paints first when nothing is loaded yet; the server's newer turns merge in after.
      const response = localChats.available()
        ? await localChats
            .conversations(accountId)
            .catch(() => [])
            .then(async (saved) => {
              const local = saved.map(normalizeConversation);
              markStoredChats(local);
              if (get().accountId === accountId && !get().working && !get().conversations.length)
                set({ conversations: local });
              return {
                conversations: await syncLocalChats(accountId, local, () => get().invocationId),
              };
            })
        : // Outside the desktop app there is no device to keep chats: the server lists them.
          await globalMistyApi.conversations("", (saved) => {
            if (get().accountId !== accountId || get().working || get().conversations.length)
              return;
            set({ conversations: saved.conversations.map(normalizeConversation) });
          });
      if (get().accountId !== accountId) return;
      if ((get().working && !reconnect) || epoch !== submissionEpoch()) {
        set({
          conversationsLoading: false,
        });
        return;
      }
      const conversations = response.conversations.map(normalizeConversation);
      // What the device sync returned is saved already.
      if (localChats.available()) markStoredChats(conversations);
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
        // Replay the saved stream into an empty response so deltas are never duplicated.
        patchConversationMessage(set, get, conversation.id, message.id, {
          content: "",
          activity: "Reconnecting to the task…",
        });
        replaceActiveGlobalInvocationStream(
          subscribeToAiInvocation(`/ai/invocations/${encodeURIComponent(invocationId)}/events`, {
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
                // Goal continuations chain: attach to the next one when it starts.
                useCollaborationStore.getState().afterRunSettled(
                  conversation.id,
                  () => void get().loadConversations(true),
                  () => get().working,
                );
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
