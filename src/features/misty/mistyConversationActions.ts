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
  resumeGlobalAgentWatches,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";
import { updateMistyDraftAttachments } from "./draftAttachments";
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
        const response = await globalMistyApi.conversations();
        if (get().accountId !== accountId) return;
        if ((get().working && !reconnect) || epoch !== submissionEpoch()) {
          set({
            conversationsLoading: false,
          });
          return;
        }
        const conversations = response.conversations.map(normalizeConversation);
        if (
          expected &&
          (expected.accountId !== accountId ||
            get().selectedAgentId !== expected.agentId ||
            get().activeConversationId !== expected.conversationId ||
            !conversations.some(
              (conversation) =>
                conversation.id === expected.conversationId &&
                conversation.agentId === expected.agentId &&
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
        resumeGlobalAgentWatches(set, get, conversations);
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
                if (event.type === "artifact.proposed" || event.type === "approval.required") {
                  patchConversationMessage(set, get, conversation.id, message.id, {
                    artifact: event.artifact,
                  });
                  set({ pendingArtifact: event.artifact, artifactConversationId: conversation.id });
                }
              },
              onError: (error) => {
                if (get().accountId === accountId && get().invocationId === invocationId)
                  set({ error: error.message, working: true });
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
      const conversation = normalizeConversation(
        await globalMistyApi.createConversation(
          "New conversation",
          "",
          requestedAgentId || get().selectedAgentId || selectedPersonalAgent("")?.id,
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
        if (existing.remote) await globalMistyApi.deleteConversation(conversationId);
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
        const renamed = existing.remote
          ? await globalMistyApi.renameConversation(conversationId, normalized)
          : { title: normalized };
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
