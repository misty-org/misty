import { subscribeAgentsInvocation as subscribeToAiInvocation } from "@/features/agents/agents_runtime";
import { adoptSignedOutAgents } from "../../personal/agent_account";
import { followAddress } from "../../runs/local-run/local_run_parts";
import type { MistyState } from "./misty_state";
import {
  applyGlobalInvocationEvent,
  normalizeConversation,
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  type MistyGet,
  type MistySet,
} from "./misty_store_updates";
import { settleRun } from "../ask/settle_run";
import { useCollaborationStore } from "../../plans/agent_collaboration";
import { localChats, markStoredChats } from "./local_chats";
import { syncLocalChats } from "./local_chat_sync";
import { submissionEpoch } from "../ask/misty_submission_epoch";

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
const retryMaxMs = 30_000;
const failuresShown = 3;

function retryLater(get: MistyGet, accountId: string, reconnect: boolean) {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(retryMaxMs, 1_000 * 2 ** retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (get().accountId === accountId) void get().loadConversations(reconnect);
  }, delay);
}

function settledRetries() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

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
    let read = false;
    try {
      void adoptSignedOutAgents(accountId).then((moved) => {
        if (moved > 0 && get().accountId === accountId) void get().loadConversations(reconnect);
      });
      const saved = await localChats.conversations(accountId);
      const local = saved.map(normalizeConversation);
      markStoredChats(local, accountId);
      if (get().accountId === accountId && !get().working && !get().conversations.length)
        set({ conversations: local });
      const response = {
        conversations: await syncLocalChats(accountId, local, () => get().invocationId),
      };
      read = true;
      settledRetries();
      if (get().accountId !== accountId) return;
      if (get().conversationsError) set({ conversationsError: null });
      if ((get().working && !reconnect) || epoch !== submissionEpoch()) {
        set({
          conversationsLoading: false,
        });
        return;
      }
      const conversations = response.conversations.map(normalizeConversation);
      markStoredChats(conversations, accountId);
      if (
        expected &&
        (expected.accountId !== accountId ||
          get().selectedAgentId !== expected.agentId ||
          get().activeConversationId !== expected.conversationId ||
          !conversations.some(
            (conversation) =>
              conversation.id === expected.conversationId &&
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
        get().activeConversationId ||
        (get().selectedAgentId ? "" : conversations.find((c) => !c.place)?.id) ||
        "";
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
        patchConversationMessage(set, get, conversation.id, message.id, {
          content: "",
          activity: "Reconnecting",
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
              settleRun(set, get, {
                state: "failed",
                conversationId: conversation.id,
                error: error.message,
              });
            },
          }),
        );
      }
    } catch (error) {
      if (get().accountId !== accountId) return;
      if (!read) {
        retryLater(get, accountId, reconnect);
        if (retryAttempt >= failuresShown)
          set({ conversationsError: error instanceof Error ? error.message : String(error) });
        return;
      }
      set({
        conversationsLoading: false,
      });
    }
  };
}
