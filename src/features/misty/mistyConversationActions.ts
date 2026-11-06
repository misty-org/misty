import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { pendingServerDeletes } from "./pendingServerDeletes";
import { splitLedger } from "@/features/agents/checkpointLedger";
import { selectedPersonalAgent } from "@/features/agents/personalAgentsStore";
import { globalMistyError } from "./globalMistyActions";
import { globalMistyApi } from "./globalMistyApi";
import type { MistyState } from "./mistyState";
import { normalizeConversation, type MistyGet, type MistySet } from "./mistyStoreHelpers";
import { updateMistyDraftAttachments } from "./draftAttachments";
import { spaceWindow } from "@/features/workspace/spaceWindow";
import { submissionEpoch } from "./mistySubmissionEpoch";

import { createLoadConversations } from "./loadConversations";
/** Changes to a conversation's turns on their way to the server. A run sent next waits for them,
 * so its history doesn't have what the person just took out. */
const turnChanges = new Map<string, Promise<unknown>>();

function changeTurns(conversationId: string, change: () => Promise<unknown>) {
  const next = (turnChanges.get(conversationId) ?? Promise.resolve())
    .then(change)
    .catch(() => undefined)
    .finally(() => {
      if (turnChanges.get(conversationId) === next) turnChanges.delete(conversationId);
    });
  turnChanges.set(conversationId, next);
  return next;
}

export function turnChangesSettled(conversationId: string): Promise<unknown> {
  return turnChanges.get(conversationId) ?? Promise.resolve();
}

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
      // It goes to the Space this window shows.
      const conversation = normalizeConversation(
        await globalMistyApi.createConversation(
          "New conversation",
          spaceWindow().spaceId ?? "",
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
        // Gone at once; a server that can't be reached is told on a later load.
        if (existing.remote) void pendingServerDeletes.delete(conversationId);
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
    setMessageLedger: (conversationId, messageId, content) => {
      const invocationId = get()
        .conversations.find((item) => item.id === conversationId)
        ?.messages.find((message) => message.id === messageId)?.invocationId;
      if (invocationId)
        void changeTurns(conversationId, () =>
          globalMistyApi.saveLedger(conversationId, invocationId, splitLedger(content).rows),
        );
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
      const dropped = existing.messages.slice(index).flatMap((message) => {
        if (message.invocationId) return [message.invocationId];
        const run = /^(invocation_.+)-user$/.exec(message.id)?.[1];
        return run ? [run] : [];
      });
      if (existing.remote && dropped.length)
        void changeTurns(conversationId, () =>
          globalMistyApi.dropTurns(conversationId, [...new Set(dropped)]),
        );
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, messages: item.messages.slice(0, index) } : item,
        ),
      });
    },
  };
}
