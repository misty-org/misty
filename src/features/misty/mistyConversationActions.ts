import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { selectedPersonalAgent } from "@/features/agents/personalAgentsStore";
import { globalMistyError } from "./globalMistyActions";
import type { MistyState } from "./mistyState";
import { newLocalConversation } from "./localConversation";
import type { MistyGet, MistySet } from "./mistyStoreHelpers";
import { updateMistyDraftAttachments } from "./draftAttachments";
import { localChats } from "./localChats";
import { spaceWindow } from "@/features/workspace/spaceWindow";
import { submissionEpoch } from "./mistySubmissionEpoch";

import { createLoadConversations } from "./loadConversations";
/** Loading, opening, creating, renaming and deleting Misty conversations. */
export function createMistyConversationActions(
  set: MistySet,
  get: MistyGet,
): Pick<
  MistyState,
  | "loadConversations"
  | "newConversation"
  | "selectConversation"
  | "deleteConversation"
  | "renameConversation"
  | "rewindConversation"
  | "setMessageLedger"
> {
  return {
    loadConversations: createLoadConversations(set, get),
    newConversation: async (_legacySpaceId, requestedAgentId) => {
      const accountId = get().accountId;
      const epoch = submissionEpoch();
      // It goes to the Space this window shows, and this device keeps it.
      const conversation = newLocalConversation(
        "New conversation",
        spaceWindow().spaceId ?? "",
        requestedAgentId || get().selectedAgentId || selectedPersonalAgent("")?.id,
      );
      // A browser handoff can get here after the user switched accounts.
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
        panel: get().panel === "closed" ? "closed" : "answer",
        query: "",
        context: [],
        browserRequest: undefined,
        error: null,
      });
      return conversation.id;
    },
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
        await localChats.deleteConversation(requestAccount, conversationId);
        // Its shell workspace goes with it. Anything it saved to a shared folder stays.
        if (hasTauriInternals())
          void invoke("agents_forget_workspace", { conversationId }).catch(() => undefined);
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
        // The name lives with the chat on this device.
        const renamed = { title: normalized };
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
    setMessageLedger: (conversationId, messageId, content) => {
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                messages: item.messages.map((message) =>
                  message.id === messageId ? { ...message, content } : message,
                ),
              }
            : item,
        ),
      });
    },
    rewindConversation: (conversationId, messageId) => {
      const existing = get().conversations.find((item) => item.id === conversationId);
      const index = existing?.messages.findIndex((message) => message.id === messageId) ?? -1;
      if (!existing || index < 0 || get().working) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, messages: item.messages.slice(0, index) } : item,
        ),
      });
    },
  };
}
