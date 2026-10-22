import { ApiRequestError } from "@/api/client";
import { subscribeAgentsInvocation as subscribeToAiInvocation } from "@/features/agents/AgentsRuntime";
import { selectedPersonalAgent } from "@/features/agents/personalAgentsStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import {
  applyGlobalInvocationEvent,
  normalizeConversation,
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";
import { settleRun } from "./settleRun";
import { useCollaborationStore } from "@/features/agents/agentCollaboration";
import { updateMistyDraftAttachments } from "./draftAttachments";
import { localChats, markStoredChats } from "./localChats";
import { syncLocalChats, thisDeviceId } from "./localChatSync";
import { submissionEpoch } from "./mistySubmissionEpoch";

/** Loading, opening, creating, renaming and deleting Misty conversations. */
export function createMistyConversationActions(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
): Pick<
  GlobalSearchState,
  | "loadConversations"
  | "newConversation"
  | "bindConversationSpace"
  | "selectConversation"
  | "deleteConversation"
  | "renameConversation"
> {
  return {
    loadConversations: async (reconnect = false, expected) => {
      const epoch = submissionEpoch();
      const accountId = get().accountId;
      if (!accountId) return;
      set({
        conversationsLoading: true,
      });
      try {
        // Chats live on this device (docs/design/agent-chats-local/BRIEF.md). Its copy
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
                return { conversations: await syncLocalChats(accountId, local) };
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
    },
    newConversation: async (_legacySpaceId, requestedAgentId) => {
      const accountId = get().accountId;
      const epoch = submissionEpoch();
      // This device keeps the chat it starts.
      const conversation = normalizeConversation(
        await globalMistyApi.createConversation(
          "New conversation",
          "",
          requestedAgentId || get().selectedAgentId || selectedPersonalAgent("")?.id,
          (await thisDeviceId()) ?? undefined,
        ),
      );
      // A browser handoff can await the server while the user switches accounts.
      // Its response belongs to the original account, including local fallbacks.
      if (get().accountId !== accountId || epoch !== submissionEpoch()) return conversation.id;
      set({
        conversations: [
          conversation,
          ...get().conversations.filter((item) => item.id !== conversation.id),
        ],
        activeConversationId: conversation.id,
        pendingArtifact: undefined,
        artifactPaneId: undefined,
        artifactConversationId: undefined,
        mode: "ask",
        panel: get().panel === "closed" ? "closed" : "answer",
        query: "",
        context: [],
        browserRequest: undefined,
        error: null,
      });
      return conversation.id;
    },
    // Retained for old entry points; context does not bind AI ownership.
    bindConversationSpace: async () => {},
    selectConversation: (activeConversationId) =>
      set({
        pendingArtifact: get()
          .conversations.find((c) => c.id === activeConversationId)
          ?.messages.slice()
          .reverse()
          .find((m) => m.artifact)?.artifact,
        artifactConversationId: activeConversationId,
        artifactPaneId: undefined,
        selectedAgentId: get().conversations.find((c) => c.id === activeConversationId)?.agentId,
        browserRequest: undefined,
        handoff: undefined,
        targets: [],
        selectedSpaceId: "",
        pendingModelOverride: undefined,
        activeConversationId,
        mode: "ask",
        panel: get().panel === "closed" ? "closed" : "answer",
        query: "",
        context: [],
        error: null,
      }),
    deleteConversation: async (conversationId) => {
      const requestAccount = get().accountId;
      const existing = get().conversations.find((item) => item.id === conversationId);
      if (!existing) return;
      try {
        if (
          get().working &&
          (get().activeConversationId === conversationId ||
            get().invocationConversationId === conversationId)
        )
          throw new Error("Stop the response before deleting this conversation.");
        // The server's row only admits and bills the chat's runs; the chat itself is here.
        if (existing.remote)
          await globalMistyApi.deleteConversation(conversationId).catch((error: unknown) => {
            if (!(error instanceof ApiRequestError && error.status === 404)) throw error;
          });
        await localChats.deleteConversation(requestAccount, conversationId);
        if (get().accountId !== requestAccount) return;
        updateMistyDraftAttachments(requestAccount, conversationId, (attachments) => {
          attachments.forEach((attachment) => {
            if (attachment.previewUrl.startsWith("blob:"))
              URL.revokeObjectURL(attachment.previewUrl);
          });
          return [];
        });
        const active = get().activeConversationId === conversationId;
        set({
          conversations: get().conversations.filter((item) => item.id !== conversationId),
          ...(active
            ? {
                activeConversationId: "",
                query: "",
                context: [],
                handoff: undefined,
                browserRequest: undefined,
                targets: [],
              }
            : {}),
          ...(active || get().artifactConversationId === conversationId
            ? {
                pendingArtifact: undefined,
                artifactPaneId: undefined,
                artifactConversationId: undefined,
              }
            : {}),
          ...(get().invocationConversationId === conversationId
            ? { invocationId: undefined, invocationConversationId: undefined }
            : {}),
          error: null,
        });
      } catch (error) {
        if (get().accountId !== requestAccount) return;
        set({ error: globalMistyError(error) });
        throw error;
      }
    },
    renameConversation: async (conversationId, title) => {
      const requestAccount = get().accountId;
      const normalized = title.trim().slice(0, 120);
      const existing = get().conversations.find((item) => item.id === conversationId);
      if (!existing || !normalized || normalized === existing.title) return;
      try {
        // The name lives with the chat on this device; the server's copy only stops it
        // from naming the chat itself.
        const renamed = { title: normalized };
        if (existing.remote)
          void globalMistyApi.renameConversation(conversationId, normalized).catch(() => undefined);
        if (get().accountId !== requestAccount) return;
        set({
          conversations: get().conversations.map((item) =>
            item.id === conversationId ? { ...item, title: renamed.title } : item,
          ),
          error: null,
        });
      } catch (error) {
        if (get().accountId !== requestAccount) return;
        set({ error: globalMistyError(error) });
        throw error;
      }
    },
  };
}
